import { bankRequest } from './client';
import { HttpError } from '../auth';
import type { Account, ActionResult, ToolContext, TransferInput } from '../types';
export async function authorizeTransfer(
  ctx: ToolContext,
  input: TransferInput,
): Promise<ActionResult | null> {
  const accounts = await bankRequest<Account[]>(ctx.userId, '/v1/accounts');
  if (!accounts.some((a) => a.id === input.fromAccountId))
    throw new HttpError(403, 'This account does not belong to this person.');
  return null;
}
