import { appDb } from '../db';
import { person } from '../people';
import { HttpError } from '../auth';
import { bankRequest, BankError } from '../banking/client';

// Telemetry and intent payloads are stored as JSON text; a row that cannot be
// parsed is surfaced as-is instead of being silently dropped or invented.
function parseJson(value: unknown) {
  if (typeof value !== 'string' || value.length === 0) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export async function caseDetail(operatorId: string, id: string) {
  if (person(operatorId)?.role !== 'operator') throw new HttpError(403, 'Operator role required.');
  const db = appDb();
  const incident = db.prepare('SELECT * FROM incidents WHERE id=?').get(id) as any;
  if (!incident) throw new HttpError(404, 'Case not found.');
  const lastMessage = db
    .prepare(
      'SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1',
    )
    .get(incident.conversation_id);
  // Last 50 messages, oldest first, so the operator reads the conversation in
  // the order it happened.
  const history = (
    db
      .prepare(
        'SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at DESC,rowid DESC LIMIT 50',
      )
      .all(incident.conversation_id) as any[]
  ).reverse();
  const events = (
    db
      .prepare(
        'SELECT * FROM events WHERE conversation_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100',
      )
      .all(incident.conversation_id) as any[]
  )
    .reverse()
    .map((e) => ({ ...e, data: parseJson(e.data) }));
  const intents = (
    db
      .prepare(
        'SELECT * FROM intents WHERE conversation_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100',
      )
      .all(incident.conversation_id) as any[]
  ).map((i) => ({ ...i, payload: parseJson(i.payload) }));
  const gaps: string[] = [];
  if (events.length === 0)
    gaps.push('No agent activity was recorded for this conversation.');
  // The bank operator endpoint requires the operator as the signing actor and
  // the customer id as a query parameter.
  let bank: {
    accounts: any[];
    operations: { id: string; amountCents: number; status: string; reference: string }[];
  } | null = null;
  try {
    const response = await bankRequest<{
      accounts?: any[];
      operations?: any[];
    }>(operatorId, `/v1/operator/customer?id=${encodeURIComponent(incident.user_id)}`);
    bank = {
      accounts: response.accounts ?? [],
      operations: (response.operations ?? []).map((o) => ({
        id: o.id,
        amountCents: o.amountCents,
        status: o.status,
        reference: o.reference,
      })),
    };
  } catch (e) {
    if (!(e instanceof BankError)) throw e;
    gaps.push('Bank operations could not be retrieved.');
  }
  return {
    incident,
    customer: person(incident.user_id),
    lastMessage,
    history,
    events,
    intents,
    bank,
    gaps: gaps.join(' '),
  };
}
