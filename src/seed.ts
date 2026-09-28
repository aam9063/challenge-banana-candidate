import { appDb } from './db';
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { restoreIndex } from './retrieval/store';
export function seedApp() {
  const db = appDb();
  db.transaction(() => {
    db.exec(
      'DELETE FROM messages; DELETE FROM conversations; DELETE FROM incidents; DELETE FROM intents; DELETE FROM approvals; DELETE FROM events; DELETE FROM runs; DELETE FROM chunks; DELETE FROM embedding_cache; DELETE FROM meta;',
    );
    const conversation = db.prepare('INSERT INTO conversations VALUES(?,?,?,?)');
    const message = db.prepare('INSERT INTO messages VALUES(?,?,?,?,?,?)');
    const histories: {
      id: string;
      userId: string;
      title: string;
      createdAt: string;
      messages: { role: string; content: string }[];
      case?: { id: string; status: string };
    }[] = JSON.parse(readFileSync(path.resolve('fixtures/conversations.json'), 'utf8'));
    for (const history of histories) {
      conversation.run(history.id, history.userId, history.title, history.createdAt);
      history.messages.forEach((entry, index) => {
        const at = new Date(Date.parse(history.createdAt) + index * 10000).toISOString();
        message.run(
          `${history.id}-message-${index}`,
          history.id,
          entry.role,
          entry.content,
          at,
          null,
        );
      });
      if (history.case) {
        db.prepare('INSERT INTO incidents VALUES(?,?,?,?,?,?)').run(
          history.case.id,
          history.userId,
          history.id,
          history.messages.at(-1)!.content,
          history.case.status,
          history.createdAt,
        );
      }
    }
    db.prepare('INSERT INTO intents VALUES(?,?,?,?,?,?,?,?,?,?)').run(
      'intent-historic-lucia',
      'lucia',
      'conv-lucia-support',
      'run-historic-lucia',
      JSON.stringify({
        fromAccountId: 'acc-lucia',
        toAccountId: 'acc-bruno',
        amountCents: 8500,
        concept: 'Team dinner',
      }),
      'failed',
      'ref-historic-lucia',
      null,
      'No response received from the bank.',
      '2026-09-23T16:41:12.000Z',
    );
    db.prepare('INSERT INTO meta VALUES(?,?)').run('seed', 'banana-v3-2026-09-25');
  })();
  const index = path.resolve('fixtures/embeddings/index.json.gz');
  if (existsSync(index)) restoreIndex(JSON.parse(gunzipSync(readFileSync(index)).toString()));
  return {
    conversations: (db.prepare('SELECT COUNT(*) n FROM conversations').get() as { n: number }).n,
    incidents: (db.prepare('SELECT COUNT(*) n FROM incidents').get() as { n: number }).n,
    indexLoaded: existsSync(index),
  };
}
