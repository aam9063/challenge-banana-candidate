import { z } from 'zod';
import { appDb } from '../db';
import { HttpError } from '../auth';
import { person } from '../people';
import { authorizeTransfer } from './authorization';
import { dispatchTransfer, stableReference } from './dispatch';
import { bankRequest, BankError } from './client';
import { recordEvent } from '../telemetry';
import type { ActionResult, Operation, ToolContext } from '../types';

export const transferSchema = z
  .object({
    fromAccountId: z.string().min(1),
    toAccountId: z.string().min(1),
    amountCents: z.number().int().positive().max(10000000),
    concept: z.string().max(200),
  })
  .strict();

type IntentRow = {
  user_id: string;
  payload: string;
  status: string;
  operation_id: string | null;
  bank_reference: string | null;
};

function markCompleted(ctx: ToolContext, operation: Operation): ActionResult {
  appDb()
    .prepare('UPDATE intents SET status=?,operation_id=?,error=NULL WHERE id=?')
    .run('completed', operation.id, ctx.intentId);
  recordEvent(ctx, 'transfer.completed', {
    status: 'completed',
    operation,
    intentId: ctx.intentId,
  });
  return { status: 'completed', operation, intentId: ctx.intentId };
}

function markFailed(ctx: ToolContext, message: string): ActionResult {
  appDb()
    .prepare('UPDATE intents SET status=?,error=? WHERE id=?')
    .run('failed', message, ctx.intentId);
  recordEvent(ctx, 'transfer.failed', {
    status: 'failed',
    error: message,
    intentId: ctx.intentId,
  });
  return { status: 'failed', error: message, intentId: ctx.intentId };
}

/**
 * Resolves an unknown outcome against the bank using the intent's stable
 * reference. Found → completed (verified fact); 404 → failed (verified
 * absence); any lookup failure → non-terminal 'processing' so the outcome can
 * be re-checked later. Never reports 'failed' without evidence.
 */
async function reconcileOutcome(ctx: ToolContext, reference: string): Promise<ActionResult> {
  try {
    const operation = await bankRequest<Operation>(
      ctx.userId,
      `/v1/operations/${encodeURIComponent(reference)}`,
    );
    return markCompleted(ctx, operation);
  } catch (e) {
    if (e instanceof BankError && e.status === 404)
      return markFailed(
        ctx,
        'The bank has no operation for this intent; the transfer did not happen.',
      );
    return {
      status: 'processing',
      intentId: ctx.intentId,
      reference,
      message:
        'The outcome of this transfer could not be verified yet. Check it later with operation_status using this reference.',
    };
  }
}

export async function transferMoney(ctx: ToolContext, args: unknown): Promise<ActionResult> {
  if (person(ctx.userId)?.role !== 'customer')
    throw new HttpError(403, 'A customer account is required.');
  const input = transferSchema.parse(args),
    db = appDb();
  const previous = db
    .prepare('SELECT user_id,payload,status,operation_id,bank_reference FROM intents WHERE id=?')
    .get(ctx.intentId) as IntentRow | undefined;
  if (previous && (previous.user_id !== ctx.userId || previous.payload !== JSON.stringify(input)))
    throw new HttpError(409, 'This intent belongs to a different payload.');

  // A completed intent already has a verified effect; never dispatch it again.
  if (previous?.status === 'completed') {
    if (previous.bank_reference) {
      try {
        const operation = await bankRequest<Operation>(
          ctx.userId,
          `/v1/operations/${encodeURIComponent(previous.bank_reference)}`,
        );
        return { status: 'completed', operation, intentId: ctx.intentId };
      } catch {
        // The stored result stands even if the enrichment lookup fails.
      }
    }
    return {
      status: 'completed',
      intentId: ctx.intentId,
      ...(previous.operation_id ? { operationId: previous.operation_id } : {}),
    };
  }

  // A processing intent may already have committed at the bank; reconcile it,
  // never re-dispatch it.
  if (previous?.status === 'processing') {
    if (previous.bank_reference) return reconcileOutcome(ctx, previous.bank_reference);
    return {
      status: 'processing',
      intentId: ctx.intentId,
      message: 'This transfer is still processing and its outcome cannot be verified yet.',
    };
  }

  db.prepare('INSERT OR IGNORE INTO intents VALUES(?,?,?,?,?,?,?,?,?,?)').run(
    ctx.intentId,
    ctx.userId,
    ctx.conversationId,
    ctx.runId,
    JSON.stringify(input),
    'created',
    null,
    null,
    null,
    new Date().toISOString(),
  );
  const permission = await authorizeTransfer(ctx, input);
  if (permission) return permission;
  db.prepare('UPDATE intents SET status=? WHERE id=?').run('processing', ctx.intentId);
  recordEvent(ctx, 'transfer.started', { status: 'processing', input, intentId: ctx.intentId });
  // Persist the stable reference before the first attempt so every retry
  // (in-loop or across calls) reuses it.
  const reference = stableReference(ctx.intentId);
  try {
    const operation = await dispatchTransfer(ctx, input);
    return markCompleted(ctx, operation);
  } catch (e) {
    // A 5xx does not prove the bank rejected the operation: reconcile against
    // the bank before reporting any terminal outcome.
    if (e instanceof BankError && e.status >= 500) return reconcileOutcome(ctx, reference);
    const message = e instanceof Error ? e.message : 'Transfer error';
    return markFailed(ctx, message);
  }
}
