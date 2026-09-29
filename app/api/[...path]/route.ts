import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { actor, sessionToken, sameOrigin, HttpError } from '../../../src/auth';
import { people, person } from '../../../src/people';
import { appDb } from '../../../src/db';
import { bankRequest, BankError } from '../../../src/banking/client';
import { transferMoney } from '../../../src/banking/actions';
import { sendMessage, answerWithEvidence } from '../../../src/agent/run';
import { runTool } from '../../../src/agent/tools';
import { caseDetail } from '../../../src/operator/view';
import { documents, readDocument, ingest } from '../../../src/ingestion/pipeline';
import { searchDocuments } from '../../../src/retrieval/search';
import { MissingOpenAIKeyError } from '../../../src/retrieval/embeddings';
import { config } from '../../../src/config';
import { allChunks } from '../../../src/retrieval/store';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(data, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
type RouteContext = { params: Promise<{ path: string[] }> };
function conversationFor(id: string, userId: string) {
  const result = appDb()
    .prepare('SELECT * FROM conversations WHERE id=? AND user_id=?')
    .get(id, userId);
  if (!result) throw new HttpError(404, 'Conversation not found.');
  return result;
}
// Approval payloads are stored as JSON text; a malformed row is surfaced
// as-is instead of being silently dropped or invented (same rule as the
// operator case view).
function parseJson(value: unknown) {
  if (typeof value !== 'string' || value.length === 0) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function pendingApprovalsFor(db: ReturnType<typeof appDb>, conversationId: string, userId: string) {
  return (
    db
      .prepare(
        `SELECT approvals.id, approvals.intent_id, approvals.expires_at, approvals.payload
         FROM approvals JOIN intents ON approvals.intent_id=intents.id
         WHERE intents.conversation_id=? AND approvals.user_id=?
           AND approvals.consumed_at IS NULL AND approvals.cancelled_at IS NULL
           AND approvals.expires_at>?
         ORDER BY approvals.rowid`,
      )
      .all(conversationId, userId, new Date().toISOString()) as any[]
  ).map((a) => ({
    id: a.id,
    intent_id: a.intent_id,
    expires_at: a.expires_at,
    payload: parseJson(a.payload),
  }));
}

/**
 * Resolves account/contact labels from the bank for a transfer pair. If the
 * label lookup fails, the raw account ids are used — names are never invented.
 */
async function transferLabels(userId: string, fromAccountId: unknown, toAccountId: unknown) {
  let fromLabel = String(fromAccountId);
  let toLabel = String(toAccountId);
  try {
    const [accounts, contacts] = await Promise.all([
      bankRequest<any[]>(userId, '/v1/accounts'),
      bankRequest<any[]>(userId, '/v1/contacts'),
    ]);
    const from = Array.isArray(accounts)
      ? accounts.find((a) => a.id === fromAccountId)
      : undefined;
    if (from?.label) fromLabel = String(from.label);
    const toContact = Array.isArray(contacts)
      ? contacts.find((c) => c.id === toAccountId)
      : undefined;
    const toAccount = Array.isArray(accounts)
      ? accounts.find((a) => a.id === toAccountId)
      : undefined;
    if (toContact) toLabel = `${toContact.name}'s ${toContact.label}`;
    else if (toAccount?.label) toLabel = String(toAccount.label);
  } catch {
    // Keep the raw account ids; the amounts and reference stay verified.
  }
  return { fromLabel, toLabel };
}

/**
 * Builds the chat receipt from verified facts only: the bank operation plus
 * resolved account/contact labels.
 */
async function receiptContent(userId: string, operation: any): Promise<string> {
  const { fromLabel, toLabel } = await transferLabels(
    userId,
    operation.fromAccountId,
    operation.toAccountId,
  );
  const amount = (Number(operation.amountCents) / 100).toFixed(2);
  return `Transfer completed: EUR ${amount} from your ${fromLabel} to ${toLabel} (concept: ${operation.concept}). Reference: ${operation.reference}.`;
}

/**
 * Builds the cancellation notice from the stored proposal payload plus
 * resolved labels only. A cancelled proposal never reached the bank, so there
 * is no bank operation and the message must never claim one.
 */
async function cancellationContent(userId: string, payload: any): Promise<string> {
  const { fromLabel, toLabel } = await transferLabels(
    userId,
    payload?.fromAccountId,
    payload?.toAccountId,
  );
  const amount = (Number(payload?.amountCents) / 100).toFixed(2);
  return `Transfer cancelled: EUR ${amount} from your ${fromLabel} to ${toLabel} (concept: ${payload?.concept}) was not sent. No money has moved.`;
}
async function handler(request: Request, context: RouteContext) {
  try {
    const { path } = await context.params;
    if (request.method === 'POST') sameOrigin(request);
    const route = path.join('/');
    if (route === 'health')
      return json({
        ok: true,
        service: 'banana-app',
        chatModel: config.chatModel,
        embeddingModel: config.embeddingModel,
        keyConfigured: !!process.env.OPENAI_API_KEY,
      });
    // Intentionally public: the person selector must work before any session
    // exists, because choosing a person here IS how a session is created.
    // This is a local simulator convenience, not authentication — every other
    // route resolves the actor from the signed session cookie below.
    if (route === 'people') return json(people);
    if (route === 'session' && request.method === 'POST') {
      const { userId } = z.object({ userId: z.string() }).parse(await request.json());
      if (!person(userId)) throw new HttpError(400, 'Unknown person.');
      return json({ person: person(userId) }, 200, {
        'Set-Cookie': `banana_actor=${sessionToken(userId)}; Path=/; HttpOnly; SameSite=Strict`,
      });
    }
    const current = actor(request),
      db = appDb();
    if (route === 'session') return json({ person: current });
    if (route === 'dashboard') {
      if (current.role === 'operator')
        return json({
          incidents: db.prepare('SELECT * FROM incidents ORDER BY created_at DESC').all(),
        });
      const [accounts, movements, contacts] = await Promise.all([
        bankRequest(current.id, '/v1/accounts'),
        bankRequest(current.id, '/v1/movements'),
        bankRequest(current.id, '/v1/contacts'),
      ]);
      const approvals = (
        db
          .prepare(
            'SELECT * FROM approvals WHERE user_id=? AND consumed_at IS NULL AND cancelled_at IS NULL AND expires_at>?',
          )
          .all(current.id, new Date().toISOString()) as any[]
      ).map((a) => ({ ...a, payload: JSON.parse(a.payload) }));
      return json({ accounts, movements, contacts, approvals });
    }
    if (route === 'conversations') {
      if (current.role !== 'customer')
        throw new HttpError(403, 'Select a customer to open a chat.');
      if (request.method === 'POST') {
        const id = randomUUID();
        db.prepare('INSERT INTO conversations VALUES(?,?,?,?)').run(
          id,
          current.id,
          'New conversation',
          new Date().toISOString(),
        );
        return json({ id }, 201);
      }
      return json(
        db
          .prepare('SELECT * FROM conversations WHERE user_id=? ORDER BY created_at DESC')
          .all(current.id),
      );
    }
    if (path[0] === 'conversations' && path[1]) {
      const conversation = conversationFor(path[1], current.id);
      if (path[2] === 'messages' && request.method === 'POST') {
        const { content } = z
          .object({ content: z.string().trim().min(1).max(8000) })
          .parse(await request.json());
        if ((conversation as any).title === 'New conversation')
          db.prepare('UPDATE conversations SET title=? WHERE id=?').run(
            content.slice(0, 50),
            path[1],
          );
        return json(await sendMessage(current.id, path[1], content));
      }
      return json({
        conversation,
        messages: db
          .prepare('SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at,rowid')
          .all(path[1]),
        pendingApprovals: pendingApprovalsFor(db, path[1], current.id),
      });
    }
    if (route === 'actions' && request.method === 'POST') {
      const body = z
        .object({
          name: z.enum([
            'transfer_money',
            'request_human',
            'operation_status',
            'list_accounts',
            'search_documents',
          ]),
          arguments: z.unknown(),
          conversationId: z.string().nullable().optional(),
          intentId: z.string().max(150).optional(),
        })
        .parse(await request.json());
      if (current.role !== 'customer') throw new HttpError(403, 'A customer is required.');
      if (body.conversationId) conversationFor(body.conversationId, current.id);
      const ctx = {
        userId: current.id,
        conversationId: body.conversationId || null,
        runId: randomUUID(),
        intentId: body.intentId || randomUUID(),
      };
      return json(await runTool(body.name, body.arguments, ctx));
    }
    if (path[0] === 'approvals' && path[1] && path[2] === 'confirm' && request.method === 'POST') {
      const approval = db
        .prepare('SELECT * FROM approvals WHERE id=? AND user_id=?')
        .get(path[1], current.id) as any;
      if (!approval) throw new HttpError(404, 'Proposal not found.');
      // Early checks give clean errors even when the intent is already
      // completed (the intent gate would otherwise return the stored result).
      if (approval.consumed_at)
        throw new HttpError(409, 'This proposal was already confirmed.');
      if (approval.cancelled_at)
        throw new HttpError(409, 'This proposal was cancelled and the transfer was not sent.');
      if (approval.expires_at <= new Date().toISOString())
        throw new HttpError(410, 'This proposal has expired; request the transfer again.');
      const intent = db
        .prepare('SELECT * FROM intents WHERE id=? AND user_id=?')
        .get(approval.intent_id, current.id) as any;
      if (!intent) throw new HttpError(404, 'Intent not found.');
      const result = await transferMoney(
        {
          userId: current.id,
          conversationId: intent.conversation_id,
          runId: randomUUID(),
          intentId: intent.id,
          approvalId: approval.id,
        },
        JSON.parse(approval.payload),
      );
      // Close the loop inside the conversation: after a verified completion,
      // append a receipt built only from the bank-verified operation. Nothing
      // is appended for non-completed results or on the error paths above.
      if (
        result.status === 'completed' &&
        intent.conversation_id &&
        result.operation &&
        typeof (result.operation as any).reference === 'string'
      ) {
        try {
          db.prepare('INSERT INTO messages VALUES(?,?,?,?,?,?)').run(
            randomUUID(),
            intent.conversation_id,
            'assistant',
            await receiptContent(current.id, result.operation),
            new Date().toISOString(),
            null,
          );
        } catch (e) {
          // The transfer completed; a receipt failure must not fail the confirm.
          console.error('receipt_message_failed', e instanceof Error ? e.name : 'unknown');
        }
      }
      return json(result);
    }
    if (path[0] === 'approvals' && path[1] && path[2] === 'cancel' && request.method === 'POST') {
      // Cancelling a proposal must not be possible for another user: the
      // user_id scope makes a foreign approval indistinguishable from a
      // missing one (404), never an authorization leak.
      const approval = db
        .prepare('SELECT * FROM approvals WHERE id=? AND user_id=?')
        .get(path[1], current.id) as any;
      if (!approval) throw new HttpError(404, 'Proposal not found.');
      if (approval.consumed_at)
        throw new HttpError(409, 'This proposal was already confirmed and cannot be cancelled.');
      // Already cancelled: idempotent success, no state change.
      if (approval.cancelled_at) return json({ status: 'cancelled' });
      const cancelled = db
        .prepare(
          'UPDATE approvals SET cancelled_at=? WHERE id=? AND user_id=? AND consumed_at IS NULL AND cancelled_at IS NULL',
        )
        .run(new Date().toISOString(), path[1], current.id);
      if (cancelled.changes !== 1)
        throw new HttpError(409, 'This proposal was already confirmed and cannot be cancelled.');
      // Close the loop inside the conversation: record what happened so the
      // chat reflects the cancellation, exactly like confirming appends a
      // receipt. Appended only once, on the first successful cancel, and only
      // when the intent belongs to a conversation. Built from the stored
      // payload — there is no bank operation for a cancelled proposal.
      try {
        const intent = db
          .prepare('SELECT * FROM intents WHERE id=? AND user_id=?')
          .get(approval.intent_id, current.id) as any;
        if (intent?.conversation_id) {
          db.prepare('INSERT INTO messages VALUES(?,?,?,?,?,?)').run(
            randomUUID(),
            intent.conversation_id,
            'assistant',
            await cancellationContent(current.id, parseJson(approval.payload)),
            new Date().toISOString(),
            null,
          );
        }
      } catch (e) {
        // The cancellation succeeded; a message failure must not fail it.
        console.error('cancel_message_failed', e instanceof Error ? e.name : 'unknown');
      }
      return json({ status: 'cancelled' });
    }
    if (path[0] === 'incidents') {
      if (current.role !== 'operator') throw new HttpError(403, 'Operator role required.');
      if (!path[1])
        return json(db.prepare('SELECT * FROM incidents ORDER BY created_at DESC').all());
      if (path[2] === 'close' && request.method === 'POST') {
        const incident = db.prepare('SELECT * FROM incidents WHERE id=?').get(path[1]) as any;
        if (!incident) throw new HttpError(404, 'Case not found.');
        if (incident.status === 'closed')
          throw new HttpError(409, 'This case is already closed.');
        db.prepare("UPDATE incidents SET status='closed' WHERE id=?").run(path[1]);
        return json(db.prepare('SELECT * FROM incidents WHERE id=?').get(path[1]));
      }
      return json(await caseDetail(current.id, path[1]));
    }
    if (path[0] === 'documents') {
      const visible = documents().filter(
        (d) => current.role === 'operator' || d.audience === 'public',
      );
      if (path[1]) {
        const doc = visible.find((d) => d.id === path[1]);
        if (!doc) throw new HttpError(404, 'Document not found.');
        if (path[2] === 'chunks')
          return json(
            allChunks()
              .filter((c) => c.documentId === doc.id)
              .map(({ vector, ...c }) => c),
          );
        return json({ ...doc, text: readDocument(doc) });
      }
      return json({
        documents: visible,
        index: db.prepare('SELECT COUNT(*) AS chunks FROM chunks').get(),
      });
    }
    if (route === 'preview-answer' && request.method === 'POST') {
      if (current.role !== 'operator') throw new HttpError(403, 'Operator role required.');
      const body = z
        .object({
          question: z.string().min(1).max(8000),
          sources: z
            .array(
              z.object({
                id: z.string(),
                documentId: z.string(),
                text: z.string().max(12000),
                title: z.string().nullable(),
                version: z.number().nullable(),
                validFrom: z.string().nullable(),
                validTo: z.string().nullable(),
                audience: z.enum(['public', 'internal']),
                score: z.number(),
              }),
            )
            .max(10),
        })
        .parse(await request.json());
      return json(await answerWithEvidence(body.question, body.sources));
    }
    if (route === 'search' && request.method === 'POST') {
      const { query } = z
        .object({ query: z.string().min(1).max(2000) })
        .parse(await request.json());
      return json({ sources: await searchDocuments(query, current.role) });
    }
    if (route === 'ingestion' && request.method === 'POST') {
      if (current.role !== 'operator') throw new HttpError(403, 'Operator role required.');
      return json(await ingest());
    }
    throw new HttpError(404, 'Route not found.');
  } catch (e) {
    if (e instanceof MissingOpenAIKeyError)
      return json({ error: e.message, code: 'missing_openai_api_key' }, 503);
    if (e instanceof HttpError || e instanceof BankError)
      return json({ error: e.message }, e.status);
    if (e instanceof z.ZodError || e instanceof SyntaxError)
      return json({ error: 'Invalid request data.' }, 400);
    console.error('app_request_failed', e instanceof Error ? e.name : 'unknown');
    return json(
      { error: 'The request could not be completed. Check the service and configuration.' },
      500,
    );
  }
}
export const GET = handler;
export const POST = handler;
