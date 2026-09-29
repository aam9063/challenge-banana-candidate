import { appDb } from '../db';
import { config } from '../config';
import { vectorBuffer, readVector, embeddingKey } from './embeddings';
import { embeddingInputFor } from '../ingestion/pipeline';
import type { Chunk } from '../types';
export type IndexDump = {
  format: 1;
  model: string;
  dimensions: number;
  chunks: (Omit<Chunk, 'vector'> & { vectorBase64: string })[];
};
export function replaceChunks(chunks: Chunk[], settings: { model: string; dimensions: number }) {
  const db = appDb();
  db.transaction(() => {
    db.exec('DELETE FROM chunks');
    const insert = db.prepare('INSERT INTO chunks VALUES(?,?,?,?,?,?,?,?,?)');
    for (const c of chunks) {
      if (c.vector?.length !== settings.dimensions) throw new Error('Incomplete index.');
      insert.run(
        c.id,
        c.documentId,
        c.text,
        c.title,
        c.version,
        c.validFrom,
        c.validTo,
        c.audience,
        vectorBuffer(c.vector),
      );
    }
    db.prepare('INSERT OR REPLACE INTO meta VALUES(?,?)').run('index-model', settings.model);
    db.prepare('INSERT OR REPLACE INTO meta VALUES(?,?)').run(
      'index-dimensions',
      String(settings.dimensions),
    );
  })();
}
export function allChunks(): Chunk[] {
  return (appDb().prepare('SELECT * FROM chunks ORDER BY id').all() as any[]).map((r) => ({
    id: r.id,
    documentId: r.document_id,
    text: r.text,
    title: r.title,
    version: r.version,
    validFrom: r.valid_from,
    validTo: r.valid_to,
    audience: r.audience,
    vector: readVector(r.vector),
  }));
}
export function exportIndex(): IndexDump {
  const db = appDb();
  const model = (
    db.prepare('SELECT value FROM meta WHERE key=?').get('index-model') as { value: string }
  ).value;
  const dimensions = Number(
    (db.prepare('SELECT value FROM meta WHERE key=?').get('index-dimensions') as { value: string })
      .value,
  );
  return {
    format: 1,
    model,
    dimensions,
    chunks: allChunks().map(({ vector, ...c }) => ({
      ...c,
      vectorBase64: vectorBuffer(vector!).toString('base64'),
    })),
  };
}
export function restoreIndex(index: IndexDump) {
  if (index.format !== 1 || index.model !== config.embeddingModel)
    throw new Error('The initial index uses a different model. Run npm run ingest.');
  const chunks = index.chunks.map(({ vectorBase64, ...c }) => ({
    ...c,
    vector: readVector(Buffer.from(vectorBase64, 'base64')),
  }));
  replaceChunks(chunks, { model: index.model, dimensions: index.dimensions });
  const db = appDb();
  db.transaction(() => {
    for (const c of chunks)
      db.prepare('INSERT OR REPLACE INTO embedding_cache VALUES(?,?)').run(
        // Key the restored cache entry exactly like the ingest path: the
        // restored vector was produced from the prefixed embedding input
        // (embeddingInputFor), not from the raw chunk text. Keying by the
        // raw text would let a query string equal to a chunk's clean text
        // hit a cache entry that is not the embedding of that string.
        embeddingKey(embeddingInputFor(c)),
        vectorBuffer(c.vector),
      );
  })();
}
