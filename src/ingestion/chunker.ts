import { createHash } from 'node:crypto';
import type { Chunk, DocumentRecord } from '../types';
export function chunkDocument(doc: DocumentRecord, text: string): Chunk[] {
  const chunks: Chunk[] = [];
  for (let offset = 0; offset < text.length; offset += 650) {
    const part = text.slice(offset, offset + 650).trim();
    if (!part) continue;
    chunks.push({
      id: createHash('sha256').update(`${doc.id}:${offset}:${part}`).digest('hex').slice(0, 24),
      documentId: doc.id,
      text: part,
      title: offset === 0 ? doc.title : null,
      version: offset === 0 ? doc.version : null,
      validFrom: offset === 0 ? doc.validFrom : null,
      validTo: offset === 0 ? doc.validTo : null,
      audience: doc.audience,
    });
  }
  return chunks;
}
