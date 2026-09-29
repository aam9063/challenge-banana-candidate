import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { config } from '../config';
import type { Chunk, DocumentRecord } from '../types';
import { chunkDocument } from './chunker';
import { embedTexts, dimensions } from '../retrieval/embeddings';
import { replaceChunks, exportIndex } from '../retrieval/store';
export function documents(): DocumentRecord[] {
  return JSON.parse(fs.readFileSync(path.resolve('fixtures/documents/manifest.json'), 'utf8'));
}
export function readDocument(doc: DocumentRecord) {
  const root = path.resolve('fixtures/documents');
  const filename = path.resolve(root, doc.file);
  if (!filename.startsWith(root + path.sep)) throw new Error('Invalid document path.');
  let text = fs.readFileSync(filename, 'utf8');
  if (filename.endsWith('.html'))
    text = text
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&');
  return text.replace(/\r\n/g, '\n');
}
/**
 * Compact prefix embedded together with the chunk text. The corpus shares a
 * long boilerplate across all 80 documents, which otherwise dominates the
 * embeddings and makes product-name queries rank the wrong product. Only
 * this prefixed string is embedded; the stored chunk text (and therefore
 * what is displayed and cited) stays the clean original.
 */
export function embeddingInputFor(chunk: {
  documentId: string;
  title: string | null;
  version: number | null;
  text: string;
}): string {
  return `${chunk.title ?? chunk.documentId} · ${chunk.documentId} · v${chunk.version ?? 0}\n${chunk.text}`;
}

export async function ingest(onProgress: (value: string) => void = () => {}) {
  const docs = documents();
  const chunks: Chunk[] = docs.flatMap((doc) => chunkDocument(doc, readDocument(doc)));
  onProgress(`${docs.length} documents · ${chunks.length} chunks`);
  // Embed the prefixed form (cache keys are hashes of the embedded string, so
  // this re-embeds the corpus once); queries are embedded as-is, without any
  // prefix.
  const vectors = await embedTexts(chunks.map(embeddingInputFor));
  const complete = chunks.map((c, i) => ({ ...c, vector: vectors[i] }));
  replaceChunks(complete, { model: config.embeddingModel, dimensions });
  onProgress('Index updated.');
  return {
    documents: docs.length,
    chunks: complete.length,
    model: config.embeddingModel,
    dimensions,
  };
}
export function saveInitialIndex() {
  fs.mkdirSync('fixtures/embeddings', { recursive: true });
  fs.writeFileSync('fixtures/embeddings/index.json.gz', gzipSync(JSON.stringify(exportIndex())));
}
