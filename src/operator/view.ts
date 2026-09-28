import { appDb } from '../db';
import { person } from '../people';
import { HttpError } from '../auth';
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
  return {
    incident,
    customer: person(incident.user_id),
    lastMessage,
    history: [],
    events: [],
    intents: [],
    bank: null,
  };
}
