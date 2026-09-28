import { randomUUID } from 'node:crypto';
import { bankRequest, BankError } from './client';
import { appDb } from '../db';
import type { Operation, ToolContext, TransferInput } from '../types';
export async function dispatchTransfer(ctx: ToolContext, input: TransferInput): Promise<Operation> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const reference = randomUUID();
    appDb().prepare('UPDATE intents SET bank_reference=? WHERE id=?').run(reference, ctx.intentId);
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
