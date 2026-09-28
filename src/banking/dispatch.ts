import { randomUUID } from 'node:crypto';
import { bankRequest, BankError } from './client';
import { appDb } from '../db';
import type { Operation, ToolContext, TransferInput } from '../types';

/**
 * Returns the intent's stable bank reference, generating and persisting it once.
 * The bank's idempotency key is actor+reference, so every attempt and every
 * re-dispatch of the same intent must reuse this reference: the bank then
 * replays a committed operation instead of creating a second debit.
 */
export function stableReference(intentId: string): string {
  const db = appDb();
  const row = db
    .prepare('SELECT bank_reference FROM intents WHERE id=?')
    .get(intentId) as { bank_reference: string | null } | undefined;
  const existing = row?.bank_reference;
  if (existing) return existing;
  const reference = randomUUID();
  db.prepare('UPDATE intents SET bank_reference=? WHERE id=?').run(reference, intentId);
  return reference;
}

export async function dispatchTransfer(ctx: ToolContext, input: TransferInput): Promise<Operation> {
  const reference = stableReference(ctx.intentId);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await bankRequest<Operation>(ctx.userId, '/v1/transfers', 'POST', {
        ...input,
        reference,
      });
    } catch (e) {
      if (!(e instanceof BankError) || e.status < 500 || attempt === 1) throw e;
    }
  }
  throw new BankError(504, 'The operation could not be completed.');
}
