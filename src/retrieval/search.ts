import { appDb } from '../db';
import { config, referenceDate } from '../config';
import { embedTexts } from './embeddings';
import { allChunks } from './store';
import type { SearchResult } from '../types';
export async function searchDocuments(
  query: string,
  role = 'customer',
  limit = 5,
): Promise<SearchResult[]> {
  const meta = appDb().prepare('SELECT value FROM meta WHERE key=?').get('index-model') as
    { value: string } | undefined;
  if (!meta) throw new Error('No document index. Run npm run setup or npm run ingest.');
  if (meta.value !== config.embeddingModel)
    throw new Error('The model does not match the index. Re-ingest the documents.');
  const [queryVector] = await embedTexts([query]);
  return allChunks()
    // Only chunks from documents in force at the reference date: the corpus
    // uses uniform date-only values (YYYY-MM-DD), so lexicographic comparison
    // is exact. Null bounds mean open-ended validity.
    .filter(
      (c) =>
        (role === 'operator' || c.audience === 'public') &&
        (c.validFrom === null || c.validFrom <= referenceDate) &&
        (c.validTo === null || c.validTo >= referenceDate),
    )
    .map(({ vector, ...c }) => {
      if (vector!.length !== queryVector.length) throw new Error('Incompatible embedding dimensions.');
      const score = vector!.reduce((sum, v, i) => sum + v * queryVector[i], 0);
      return { ...c, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
