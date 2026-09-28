import { randomUUID } from 'node:crypto';
import { bankRequest } from './client';
import { appDb } from '../db';
import { HttpError } from '../auth';
import type { Account, ActionResult, ToolContext, TransferInput } from '../types';

type ApprovalRow = {
  id: string;
  user_id: string;
  intent_id: string;
  payload: string;
  expires_at: string;
  consumed_at: string | null;
  cancelled_at: string | null;
};

const APPROVAL_TTL_MS = 10 * 60 * 1000;

function pendingApprovalFor(db: ReturnType<typeof appDb>, intentId: string, userId: string) {
  return db
    .prepare(
      'SELECT * FROM approvals WHERE intent_id=? AND user_id=? AND consumed_at IS NULL AND cancelled_at IS NULL AND expires_at>?',
    )
    .get(intentId, userId, new Date().toISOString()) as ApprovalRow | undefined;
}

export async function authorizeTransfer(
  ctx: ToolContext,
  input: TransferInput,
): Promise<ActionResult | null> {
  const accounts = await bankRequest<Account[]>(ctx.userId, '/v1/accounts');
  if (!accounts.some((a) => a.id === input.fromAccountId))
    throw new HttpError(403, 'This account does not belong to this person.');
  const db = appDb();

  // Agent-initiated: a proposal must be reviewed by the person before any
  // dispatch. The lookup and insert run synchronously (no await between them),
  // so a retry of the same intent reuses the same pending proposal.
  if (!ctx.approvalId) {
    const existing = pendingApprovalFor(db, ctx.intentId, ctx.userId);
    if (existing)
      return {
        status: 'requires_confirmation',
        approvalId: existing.id,
        expiresAt: existing.expires_at,
        proposal: input,
      };
    const approvalId = randomUUID();
    const expiresAt = new Date(Date.now() + APPROVAL_TTL_MS).toISOString();
    db.prepare(
      'INSERT INTO approvals(id,user_id,intent_id,payload,expires_at,consumed_at,cancelled_at) VALUES(?,?,?,?,?,?,?)',
    ).run(
      approvalId,
      ctx.userId,
      ctx.intentId,
      JSON.stringify(input),
      expiresAt,
      null,
      null,
    );
    return {
      status: 'requires_confirmation',
      approvalId,
      expiresAt,
      proposal: input,
    };
  }

  // Confirm path: the approval must be pending, unexpired, and describe
  // exactly the transfer being executed.
  const approval = db
    .prepare('SELECT * FROM approvals WHERE id=? AND user_id=?')
    .get(ctx.approvalId, ctx.userId) as ApprovalRow | undefined;
  if (!approval) throw new HttpError(404, 'Proposal not found.');
  if (approval.consumed_at) throw new HttpError(409, 'This proposal was already confirmed.');
  if (approval.cancelled_at)
    throw new HttpError(409, 'This proposal was cancelled and the transfer was not sent.');
  if (approval.expires_at <= new Date().toISOString())
    throw new HttpError(410, 'This proposal has expired; request the transfer again.');
  if (approval.payload !== JSON.stringify(input))
    throw new HttpError(409, 'The proposal does not match the transfer being confirmed.');
  // Consume atomically: exactly one confirm may win the race.
  const consumed = db
    .prepare(
      'UPDATE approvals SET consumed_at=? WHERE id=? AND consumed_at IS NULL AND cancelled_at IS NULL',
    )
    .run(new Date().toISOString(), approval.id);
  if (consumed.changes !== 1)
    throw new HttpError(409, 'This proposal was already confirmed.');
  return null;
}
