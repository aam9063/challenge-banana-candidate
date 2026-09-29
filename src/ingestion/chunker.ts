import { createHash } from 'node:crypto';
import type { Chunk, DocumentRecord } from '../types';

/**
 * Hard bound for a single chunk. Sections at or below this size are kept
 * whole; longer sections are sub-split into windows of exactly this size,
 * so a chunk never exceeds the bound (before trimming).
 */
const MAX_CHARS = 650;

/**
 * Split the document into level-2 markdown sections. Each entry is
 * [character offset of the section start in the document, section text].
 * The `## ` heading line stays inside its section; any preamble before the
 * first heading forms the first section.
 */
export function splitSections(text: string): [number, string][] {
  const sections: [number, string][] = [];
  let start = 0;
  let cursor = 0;
  for (const line of text.split('\n')) {
    if (line.startsWith('## ') && cursor > start) {
      sections.push([start, text.slice(start, cursor)]);
      start = cursor;
    }
    cursor += line.length + 1; // +1 restores the '\n' separator.
  }
  sections.push([start, text.slice(start)]);
  return sections;
}

/**
 * Section-aware chunking: split on level-2 markdown headings first so a
 * chunk rarely straddles unrelated topics, then sub-split any section longer
 * than MAX_CHARS into fixed windows (same strategy as the previous flat
 * chunking). Chunk ids stay content-addressed: sha256 of
 * `${doc.id}:${offset}:${text}` where offset is the chunk's character offset
 * in the full document, exactly as before.
 */
export function chunkDocument(doc: DocumentRecord, text: string): Chunk[] {
  const chunks: Chunk[] = [];
  const push = (offset: number, part: string) => {
    const trimmed = part.trim();
    if (!trimmed) return; // Drop pure-whitespace chunks.
    chunks.push({
      id: createHash('sha256').update(`${doc.id}:${offset}:${trimmed}`).digest('hex').slice(0, 24),
      documentId: doc.id,
      text: trimmed,
      title: doc.title,
      version: doc.version,
      validFrom: doc.validFrom,
      validTo: doc.validTo,
      audience: doc.audience,
    });
  };
  for (const [offset, section] of splitSections(text)) {
    if (section.length <= MAX_CHARS) {
      push(offset, section);
      continue;
    }
    for (let i = 0; i < section.length; i += MAX_CHARS)
      push(offset + i, section.slice(i, i + MAX_CHARS));
  }
  return chunks;
}
