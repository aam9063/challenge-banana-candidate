import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { FunctionTool } from 'openai/resources/responses/responses';
import { bankRequest } from '../banking/client';
import { transferMoney } from '../banking/actions';
import { evaluateFees } from '../banking/feePolicy';
import { searchDocuments, isHistoricalQuery } from '../retrieval/search';
import { appDb } from '../db';
import { recordEvent } from '../telemetry';
import type { Account, BankMovement, ToolContext } from '../types';
const object = (properties: Record<string, unknown>) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const string = { type: 'string' };
export const toolDefinitions: FunctionTool[] = [
  {
    type: 'function',
    name: 'list_accounts',
    description: "Get the current customer's accounts, balances, and available recipients.",
    parameters: object({}),
    strict: true,
  },
  {
    type: 'function',
    name: 'search_documents',
    description:
      "Search the bank's documentation for policies and procedures. For historical questions (before, previously, used to, a past year, ...) it also returns archived documents whose validity window has ended; their sources carry validFrom/validTo/version so the answer can label them as historical.",
    parameters: object({ query: string }),
    strict: true,
  },
  {
    type: 'function',
    name: 'fee_status',
    description:
      "Return the monthly fee per account for the current month, decided deterministically from the customer's own ledger crossed with the in-force policy document: fee amount, waiver conditions with evidence, policy citation, and caveats. Use it for any question about fees or charges instead of answering from documentation alone.",
    parameters: object({}),
    strict: true,
  },
  {
    type: 'function',
    name: 'transfer_money',
    description: 'Send a transfer between simulator accounts. Amounts are integer cents.',
    parameters: object({
      fromAccountId: string,
      toAccountId: string,
      amountCents: { type: 'integer' },
      concept: string,
    }),
    strict: true,
  },
  {
    type: 'function',
    name: 'operation_status',
    description: 'Look up an operation by its bank reference.',
    parameters: object({ reference: string }),
    strict: true,
  },
  {
    type: 'function',
    name: 'request_human',
    description: 'Open a human support case for this conversation.',
    parameters: object({ summary: string }),
    strict: true,
  },
];
export async function runTool(name: string, args: unknown, ctx: ToolContext): Promise<unknown> {
  const started = Date.now();
  recordEvent(ctx, 'tool.started', { tool: name, status: 'started', arguments: args });
  let result: unknown;
  try {
    switch (name) {
      case 'list_accounts':
        result = {
          accounts: await bankRequest(ctx.userId, '/v1/accounts'),
          contacts: await bankRequest(ctx.userId, '/v1/contacts'),
        };
        break;
      case 'search_documents': {
        const { query } = z.object({ query: z.string().max(2000) }).parse(args);
        // Historical questions also retrieve ended validity windows so the
        // model can cite the archived value instead of reporting no
        // documentation; the default stays in-force-only.
        result = {
          sources: await searchDocuments(query, undefined, undefined, {
            includeExpired: isHistoricalQuery(query),
          }),
        };
        break;
      }
      case 'fee_status': {
        // Identity comes from the session server-side; tool arguments carry no
        // user id, so the customer can only ever see their own data.
        const [accounts, movements] = await Promise.all([
          bankRequest<Account[]>(ctx.userId, '/v1/accounts'),
          bankRequest<BankMovement[]>(ctx.userId, '/v1/movements'),
        ]);
        result = evaluateFees({ userId: ctx.userId, accounts, movements });
        break;
      }
      case 'transfer_money':
        result = await transferMoney(ctx, args);
        break;
      case 'operation_status':
        result = await bankRequest(
          ctx.userId,
          `/v1/operations/${encodeURIComponent(z.object({ reference: z.string() }).parse(args).reference)}`,
        );
        break;
      case 'request_human': {
        if (!ctx.conversationId) throw new Error('A conversation is required to open a case.');
        const { summary } = z.object({ summary: z.string().min(1).max(2000) }).parse(args);
        const existing = appDb()
          .prepare('SELECT id FROM incidents WHERE conversation_id=? AND status=?')
          .get(ctx.conversationId, 'open') as { id: string } | undefined;
        const id = existing?.id || randomUUID();
        if (!existing)
          appDb()
            .prepare('INSERT INTO incidents VALUES(?,?,?,?,?,?)')
            .run(id, ctx.userId, ctx.conversationId, summary, 'open', new Date().toISOString());
        result = { status: 'open', incidentId: id };
        break;
      }
      default:
        throw new Error('Unknown tool.');
    }
    recordEvent(ctx, 'tool.completed', {
      tool: name,
      status: 'completed',
      arguments: args,
      output: result,
      durationMs: Date.now() - started,
    });
    return result;
  } catch (e) {
    const error = e instanceof Error ? e.message : 'Tool error';
    recordEvent(ctx, 'tool.failed', {
      tool: name,
      status: 'failed',
      arguments: args,
      error,
      durationMs: Date.now() - started,
    });
    return { status: 'failed', error };
  }
}
