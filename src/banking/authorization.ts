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

export async function authorizeTransfer(
  ctx: ToolContext,
  input: TransferInput,
): Promise<ActionResult | null> {
  const accounts = await bankRequest<Account[]>(ctx.userId, '/v1/accounts');
  if (!accounts.some((a) => a.id === input.fromAccountId))
    throw new HttpError(403, 'This account does not belong to this person.');
  const db = appDb();

  // Agent-initiated: a proposal must be reviewed by the person before any
  // dispatch. The lookups and writes below run synchronously (no await between
  // them), so concurrent agent turns cannot create duplicates either.
  if (!ctx.approvalId) {
    if (ctx.conversationId) {
      // Reuse: an identical pending proposal in the same conversation is
      // returned as-is (same approvalId, no new row), so a repeated identical
      // request is idempotent even though every agent turn creates a new
      // intent.
      const identical = db
        .prepare(
          `SELECT a.* FROM approvals a JOIN intents i ON i.id=a.intent_id
           WHERE i.conversation_id=? AND a.user_id=?
             AND a.consumed_at IS NULL AND a.cancelled_at IS NULL
             AND a.expires_at>? AND a.payload=?`,
        )
        .get(
          ctx.conversationId,
          ctx.userId,
          new Date().toISOString(),
          JSON.stringify(input),
        ) as ApprovalRow | undefined;
      if (identical)
        return {
          status: 'requires_confirmation',
          approvalId: identical.id,
          expiresAt: identical.expires_at,
          proposal: input,
        };
      // Supersede: only one pending proposal per conversation survives. Other
      // pending proposals of this conversation are cancelled silently with a
      // direct UPDATE (this is not a user cancellation, so no chat message is
      // recorded). The join scopes the update to this conversation only:
      // approvals of other conversations — and of no conversation — are never
      // touched.
      db.prepare(
        `UPDATE approvals SET cancelled_at=?
         WHERE user_id=? AND consumed_at IS NULL AND cancelled_at IS NULL
           AND expires_at>?
           AND intent_id IN (SELECT id FROM intents WHERE conversation_id=?)`,
      ).run(
        new Date().toISOString(),
        ctx.userId,
        new Date().toISOString(),
        ctx.conversationId,
      );
    } else {
      // No conversation (e.g. the manual transfer form): reuse an identical
      // pending proposal for this user regardless of intent, so a double
      // click or a repeat submit does not create a second user-visible
      // proposal. A different payload creates a new one. Limitation: without
      // a conversation there is no scope to supersede, so pending proposals
      // with different payloads can still pile up and are only cleaned up by
      // expiry.
      const identical = db
        .prepare(
          `SELECT a.* FROM approvals a JOIN intents i ON i.id=a.intent_id
           WHERE a.user_id=? AND i.conversation_id IS NULL
             AND a.consumed_at IS NULL AND a.cancelled_at IS NULL
             AND a.expires_at>? AND a.payload=?`,
        )
        .get(
          ctx.userId,
          new Date().toISOString(),
          JSON.stringify(input),
        ) as ApprovalRow | undefined;
      if (identical)
        return {
          status: 'requires_confirmation',
          approvalId: identical.id,
          expiresAt: identical.expires_at,
          proposal: input,
        };
    }
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
