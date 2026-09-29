import { appDb } from '../db';
import { config, referenceDate } from '../config';
import { embedTexts } from './embeddings';
import { allChunks } from './store';
import type { SearchResult } from '../types';

/**
 * Deterministic, conservative historical-intent classifier (pure function
 * over the query text). A query counts as historical when any of these
 * documented patterns matches (case-insensitive, word-bounded):
 *
 * - "before", "prior to"              (an explicit reference to a past point)
 * - "previously", "formerly"          (explicit past-tense policy wording)
 * - "used to", "no longer"            (change-over-time phrasing)
 * - "old", "older"                    (as words, not substrings)
 * - "historical", "history"
 * - "archive", "archived", "archives"
 * - "last year", "last month"
 * - an explicit year strictly before the reference year (e.g. "in 2025"
 *   when the reference date is in 2026)
 *
 * Anything not matching stays non-historical: current-fee and current-policy
 * questions must keep the default in-force-only search.
 */
const HISTORICAL_PATTERNS: RegExp[] = [
  /\bbefore\b/i,
  /\bprior to\b/i,
  /\bpreviously\b/i,
  /\bformerly\b/i,
  /\bused to\b/i,
  /\bno longer\b/i,
  /\bold(?:er)?\b/i,
  /\bhistor(?:y|ical)\b/i,
  /\barchives?\b/i,
  /\blast (?:year|month)\b/i,
];

export function isHistoricalQuery(query: string): boolean {
  if (HISTORICAL_PATTERNS.some((pattern) => pattern.test(query))) return true;
  // An explicit past year, e.g. "in 2025", when the reference date is 2026.
  const referenceYear = Number(referenceDate.slice(0, 4));
  return (query.match(/\b(?:19|20)\d{2}\b/g) ?? []).some((y) => Number(y) < referenceYear);
}

export type SearchOptions = {
  /**
   * When true, chunks whose validity window has ended (validTo before the
   * reference date) are also returned, for genuinely historical questions.
   * The default keeps the previous behavior: only documents in force at the
   * reference date. Documents with a future validFrom stay excluded either
   * way: they never applied.
   */
  includeExpired?: boolean;
};

export async function searchDocuments(
  query: string,
  role = 'customer',
  limit = 5,
  options: SearchOptions = {},
): Promise<SearchResult[]> {
  const meta = appDb().prepare('SELECT value FROM meta WHERE key=?').get('index-model') as
    { value: string } | undefined;
  if (!meta) throw new Error('No document index. Run npm run setup or npm run ingest.');
  if (meta.value !== config.embeddingModel)
    throw new Error('The model does not match the index. Re-ingest the documents.');
  const [queryVector] = await embedTexts([query]);
  return allChunks()
    // Only chunks from documents in force at the reference date, plus, when
    // includeExpired is set, chunks whose validity window has already ended.
    // The corpus uses uniform date-only values (YYYY-MM-DD), so lexicographic
    // comparison is exact. Null bounds mean open-ended validity.
    .filter(
      (c) =>
        (role === 'operator' || c.audience === 'public') &&
        (c.validFrom === null || c.validFrom <= referenceDate) &&
        (c.validTo === null ||
          c.validTo >= referenceDate ||
          (options.includeExpired === true && c.validTo < referenceDate)),
    )
    .map(({ vector, ...c }) => {
      if (vector!.length !== queryVector.length) throw new Error('Incompatible embedding dimensions.');
      const score = vector!.reduce((sum, v, i) => sum + v * queryVector[i], 0);
      return { ...c, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
