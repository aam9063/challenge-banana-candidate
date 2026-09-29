import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'banana-tests-'));
process.env.DATA_DIR = temp;
process.env.BANK_DATA_DIR = temp;
const { seedBank } = await import('../simulator/seed');
const { bankDb, closeBankDb } = await import('../simulator/db');
const { transfer, listAccounts, setScenario, operationByReference } =
  await import('../simulator/bank');
const { seedApp } = await import('../src/seed');
const { appDb, closeAppDb } = await import('../src/db');
const { actor, sessionToken, sameOrigin, HttpError } = await import('../src/auth');
const { documents, readDocument } = await import('../src/ingestion/pipeline');
const { chunkDocument, splitSections } = await import('../src/ingestion/chunker');
const { allChunks, replaceChunks, restoreIndex } = await import('../src/retrieval/store');
const { evaluateFees } = await import('../src/banking/feePolicy');
const { searchDocuments } = await import('../src/retrieval/search');
const { embeddingKey, vectorBuffer, readVector, dimensions } = await import(
  '../src/retrieval/embeddings'
);
import type { BankMovement, Chunk, DocumentRecord } from '../src/types';

const input = {
  fromAccountId: 'acc-lucia',
  toAccountId: 'acc-bruno',
  amountCents: 1000,
  concept: 'Test',
};
function snapshot() {
  return {
    accounts: bankDb().prepare('SELECT * FROM accounts ORDER BY id').all(),
    movements: bankDb().prepare('SELECT * FROM movements ORDER BY id').all(),
    operations: bankDb().prepare('SELECT * FROM operations ORDER BY id').all(),
  };
}
test('reset reproduces consistent accounts and transactions', () => {
  seedBank();
  const before = snapshot();
  setScenario('normal');
  transfer('lucia', 'test-reset', input);
  seedBank();
  assert.deepEqual(snapshot(), before);
  for (const a of before.accounts as any[]) {
    const sum = (
      bankDb()
        .prepare('SELECT SUM(amountCents) AS total FROM movements WHERE accountId=?')
        .get(a.id) as { total: number }
    ).total;
    assert.equal(sum, a.balanceCents);
  }
});
test('a transfer debits and credits without creating money', () => {
  seedBank();
  setScenario('normal');
  const total = () => bankDb().prepare('SELECT SUM(balanceCents) AS total FROM accounts').get();
  const before = total(),
    balance = listAccounts('lucia')[0].balanceCents;
  const result = transfer('lucia', 'test-normal', input);
  assert.equal(result.operation.status, 'completed');
  assert.deepEqual(total(), before);
  assert.equal(listAccounts('lucia')[0].balanceCents, balance - 1000);
});
test('the bank guarantees idempotency by actor and reference', () => {
  seedBank();
  setScenario('normal');
  const first = transfer('lucia', 'stable', input),
    before = snapshot();
  const second = transfer('lucia', 'stable', input);
  assert.equal(second.operation.id, first.operation.id);
  assert.equal(second.replay, true);
  assert.deepEqual(snapshot(), before);
  assert.throws(
    () => transfer('lucia', 'stable', { ...input, amountCents: 1200 }),
    /different operation/,
  );
});
test('different intents with the same payload remain separate transfers', () => {
  seedBank();
  setScenario('normal');
  const a = transfer('lucia', 'one', input),
    b = transfer('lucia', 'two', input);
  assert.notEqual(a.operation.id, b.operation.id);
});
test("insufficient funds and another holder's account leave the ledger unchanged", () => {
  seedBank();
  setScenario('normal');
  const before = snapshot();
  assert.throws(() => transfer('bruno', 'foreign', input), /not authorized/);
  assert.throws(
    () => transfer('diego', 'low', { ...input, fromAccountId: 'acc-diego', amountCents: 10000 }),
    /Insufficient/,
  );
  assert.throws(() => transfer('marta', 'operator', input), /account holder/);
  assert.deepEqual(snapshot(), before);
});
test('non-integer amounts, negative amounts, and invalid destinations are rejected', () => {
  seedBank();
  setScenario('normal');
  const before = snapshot();
  for (const amountCents of [-1, 0, 0.5, Infinity, 10000001])
    assert.throws(() => transfer('lucia', 'invalid', { ...input, amountCents }));
  assert.throws(() => transfer('lucia', 'same', { ...input, toAccountId: 'acc-lucia' }));
  assert.deepEqual(snapshot(), before);
});
test('a failure before commit does not move money', () => {
  seedBank();
  setScenario('reject-before');
  const before = snapshot();
  assert.equal(transfer('lucia', 'reject', input).fault, 'reject-before');
  assert.deepEqual(snapshot(), before);
});
test('a lost response preserves a single queryable effect', () => {
  seedBank();
  setScenario('lost-response');
  const first = transfer('lucia', 'lost', input);
  assert.equal(first.fault, 'lost-response');
  assert.equal(operationByReference('lucia', 'lost')?.id, first.operation.id);
  assert.equal(operationByReference('bruno', 'lost'), undefined);
  assert.equal(transfer('lucia', 'lost', input).replay, true);
});
test('intermittent scenarios repeat with the same seed', () => {
  const run = () => {
    seedBank();
    setScenario('intermittent', 17);
    return Array.from({ length: 8 }, (_, i) => transfer('lucia', `sequence-${i}`, input).fault);
  };
  assert.deepEqual(run(), run());
  assert.ok(run().includes('lost-response'));
});
test('the application seed preserves reproducible histories and index', () => {
  const first = seedApp();
  assert.equal(first.indexLoaded, true);
  assert.equal(
    (appDb().prepare('SELECT COUNT(*) n FROM conversations').get() as { n: number }).n,
    47,
  );
  const histories = appDb().prepare('SELECT * FROM conversations ORDER BY id').all();
  const messages = appDb().prepare('SELECT * FROM messages ORDER BY id').all();
  assert.equal(first.incidents, 17);
  assert.equal(
    (
      appDb().prepare("SELECT COUNT(*) n FROM incidents WHERE status='closed'").get() as {
        n: number;
      }
    ).n,
    8,
  );
  assert.equal(
    (
      appDb()
        .prepare(
          'SELECT COUNT(*) n FROM conversations c WHERE NOT EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id=c.id)',
        )
        .get() as { n: number }
    ).n,
    0,
  );
  const chunks = allChunks();
  assert.ok(chunks.length > 300);
  assert.ok(chunks.every((c) => c.vector?.length === 1536));
  seedApp();
  assert.deepEqual(allChunks(), chunks);
  assert.deepEqual(appDb().prepare('SELECT * FROM conversations ORDER BY id').all(), histories);
  assert.deepEqual(appDb().prepare('SELECT * FROM messages ORDER BY id').all(), messages);
});
test('the signed session determines the actor and rejects forged identities', () => {
  const req = (cookie: string) =>
    new Request('http://localhost/api', { headers: { cookie, 'x-user-id': 'bruno' } });
  assert.equal(actor(req(`banana_actor=${sessionToken('lucia')}`)).id, 'lucia');
  assert.throws(() => actor(req('banana_actor=bruno.invalid')));
  assert.throws(() => actor(req('')));
  assert.doesNotThrow(() =>
    sameOrigin(
      new Request('http://localhost/api', {
        headers: { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000' },
      }),
    ),
  );
  assert.throws(() =>
    sameOrigin(
      new Request('http://localhost/api', {
        headers: { host: '127.0.0.1:3000', origin: 'https://example.com' },
      }),
    ),
  );
});
test('corpus originals exist and have unique sources', () => {
  const docs = documents();
  assert.equal(docs.length, 80);
  assert.equal(new Set(docs.map((d) => d.id)).size, 80);
  assert.ok(docs.some((d) => d.audience === 'internal'));
  assert.ok(docs.some((d) => d.validTo));
  assert.ok(docs.every((d) => readDocument(d).length > 1000));
});
test('every chunk of a multi-part document carries the document metadata', () => {
  const doc: DocumentRecord = {
    id: 'meta-doc',
    title: 'Meta · test document',
    file: 'unused.md',
    version: 3,
    validFrom: '2026-01-01',
    validTo: null,
    audience: 'public',
    family: 'fees',
  };
  const chunks = chunkDocument(doc, 'x'.repeat(1500));
  assert.ok(chunks.length >= 2);
  for (const chunk of chunks) {
    assert.equal(chunk.documentId, doc.id);
    assert.equal(chunk.title, doc.title);
    assert.equal(chunk.version, doc.version);
    assert.equal(chunk.validFrom, doc.validFrom);
    assert.equal(chunk.validTo, doc.validTo);
    assert.equal(chunk.audience, doc.audience);
  }
});

test('chunking splits on level-2 headings and keeps chunks within the bound', () => {
  const doc: DocumentRecord = {
    id: 'section-doc',
    title: 'Section · test document',
    file: 'unused.md',
    version: 1,
    validFrom: '2026-01-01',
    validTo: null,
    audience: 'public',
    family: 'fees',
  };
  const text =
    '# Section · test document\n\nPreamble before the first heading.\n\n' +
    `## First section\n${'a'.repeat(700)}\n\n` +
    '## Second section\nShort content here.\n';
  const chunks = chunkDocument(doc, text);
  // Every chunk stays within the sub-split window (before trimming there is
  // no chunk above the bound at all).
  assert.ok(chunks.every((c) => c.text.length <= 650));
  // Each heading line stays inside its own section's chunks.
  const headedChunks = chunks.filter((c) => c.text.startsWith('## '));
  assert.equal(headedChunks.length, 2);
  assert.ok(headedChunks.some((c) => c.text.startsWith('## First section')));
  assert.ok(headedChunks.some((c) => c.text.startsWith('## Second section')));
  // The preamble is its own chunk and does not bleed into the first section.
  assert.ok(chunks.some((c) => c.text.includes('Preamble before the first heading.')));
  // A long section is sub-split rather than truncated.
  const firstSectionChunks = chunks.filter((c) => c.text.includes('## First section') || /^a+$/.test(c.text));
  assert.ok(firstSectionChunks.length >= 2);
  // Chunk ids are deterministic and content-addressed by (docId, offset, text).
  const again = chunkDocument(doc, text);
  assert.deepEqual(
    again.map((c) => c.id),
    chunks.map((c) => c.id),
  );
  // Expected (offset, trimmed text) pairs recomputed from the exported
  // section splitter, then the id formula checked per chunk.
  const expected: [number, string][] = [];
  for (const [offset, section] of splitSections(text)) {
    if (section.length <= 650) expected.push([offset, section.trim()]);
    else
      for (let i = 0; i < section.length; i += 650)
        expected.push([offset + i, section.slice(i, i + 650).trim()]);
  }
  assert.deepEqual(
    chunks.map((c) => c.text),
    expected.map(([, t]) => t),
  );
  for (const [index, [offset, trimmed]] of expected.entries())
    assert.equal(
      createHash('sha256').update(`${doc.id}:${offset}:${trimmed}`).digest('hex').slice(0, 24),
      chunks[index].id,
    );
});

test('chunking drops pure-whitespace chunks', () => {
  const doc: DocumentRecord = {
    id: 'ws-doc',
    title: 'Whitespace · test document',
    file: 'unused.md',
    version: 1,
    validFrom: '2026-01-01',
    validTo: null,
    audience: 'public',
    family: 'fees',
  };
  assert.deepEqual(chunkDocument(doc, '   \n\n \t \n'), []);
  // A short heading-free document stays a single chunk; the whitespace-only
  // middle section must not become a chunk of its own.
  const chunks = chunkDocument(doc, 'content\n\n   \n\nmore content');
  assert.equal(chunks.length, 1);
  assert.match(chunks[0].text, /more content$/);
});

test('ingest embeds a document prefix while storing the clean text', async () => {
  const { embeddingInputFor } = await import('../src/ingestion/pipeline');
  const chunk: Chunk = {
    id: 'chunk-prefix',
    documentId: 'community-fees-2026',
    text: 'The Community monthly fee is EUR 2 per month.',
    title: 'Community · fees',
    version: 2,
    validFrom: '2026-01-01',
    validTo: null,
    audience: 'public',
  };
  const embedded = embeddingInputFor(chunk);
  // The prefix carries the document identity ahead of the text.
  assert.equal(
    embedded,
    `Community · fees · community-fees-2026 · v2\n${chunk.text}`,
  );
  // The embedding cache is keyed by a hash of the embedded string: the
  // prefixed input and the raw text must not share a cache key.
  assert.notEqual(embeddingKey(embedded), embeddingKey(chunk.text));
  // The stored chunk text is untouched.
  assert.equal(chunk.text, 'The Community monthly fee is EUR 2 per month.');
});

test('restoreIndex seeds the embedding cache with the ingest keying', async () => {
  seedApp();
  const { embeddingInputFor } = await import('../src/ingestion/pipeline');
  const vector = Array.from({ length: dimensions }, (_, i) => (i === 1 ? 0.5 : 0));
  const chunk = {
    id: 'chunk-restore-key',
    documentId: 'doc-restore-key',
    text: 'The Aurora published monthly fee is EUR 6.',
    title: 'Aurora · fees',
    version: 2,
    validFrom: '2026-01-01',
    validTo: null,
    audience: 'public',
    vectorBase64: vectorBuffer(vector).toString('base64'),
  };
  restoreIndex({
    format: 1,
    model: config.embeddingModel,
    dimensions,
    chunks: [chunk],
  });
  const cached = (key: string) =>
    appDb().prepare('SELECT vector FROM embedding_cache WHERE key=?').get(key) as
      | { vector: Buffer }
      | undefined;
  // The restored entry is keyed by the prefixed embedding input, the same
  // string the ingest path embedded: looking the chunk's embedding input up
  // later must hit this entry.
  const restored = cached(embeddingKey(embeddingInputFor(chunk)));
  assert.ok(restored);
  assert.deepEqual(readVector(restored.vector), vector);
  // The raw chunk text must NOT be a cache key: a query equal to the clean
  // text must never resolve to this chunk's vector.
  assert.equal(cached(embeddingKey(chunk.text)), undefined);
});

test('search keeps only documents in force at the reference date', async () => {
  seedApp();
  const query = `validity-check-${Date.now()}`;
  const queryVector = Array.from({ length: dimensions }, (_, i) => (i === 0 ? 1 : 0));
  // Pre-cache the query embedding so the search needs no API call.
  appDb()
    .prepare('INSERT OR REPLACE INTO embedding_cache VALUES(?,?)')
    .run(embeddingKey(query), vectorBuffer(queryVector));
  const base = {
    text: 'validity test chunk',
    audience: 'public',
    version: 1,
    title: 'Validity · test',
    validFrom: '2026-01-01',
    validTo: null,
  };
  const chunk = (overrides: Partial<Chunk> & { id: string; documentId: string }): Chunk =>
    ({ ...base, ...overrides }) as Chunk;
  const expired = chunk({
    id: 'chunk-expired',
    documentId: 'doc-expired',
    validTo: '2026-08-31',
    vector: queryVector, // would rank first if not filtered
  });
  const current = chunk({
    id: 'chunk-current',
    documentId: 'doc-current',
    validTo: null,
    vector: queryVector.map((v) => v * 0.5), // lower score than the expired one
  });
  const future = chunk({
    id: 'chunk-future',
    documentId: 'doc-future',
    validFrom: '2026-10-01',
    validTo: null,
    vector: queryVector.map((v) => v * 0.4),
  });
  replaceChunks([expired, current, future], { model: config.embeddingModel, dimensions });
  const results = await searchDocuments(query, 'customer', 5);
  assert.deepEqual(
    results.map((r) => r.documentId),
    ['doc-current'],
  );
  assert.equal(results[0].title, 'Validity · test');
  assert.equal(results[0].version, 1);
  // Sources carry their validity metadata so answers can label them.
  assert.equal(results[0].validFrom, '2026-01-01');
  assert.equal(results[0].validTo, null);
});

test('search can include expired documents for historical questions', async () => {
  seedApp();
  const query = `historical-check-${Date.now()}`;
  const queryVector = Array.from({ length: dimensions }, (_, i) => (i === 0 ? 1 : 0));
  appDb()
    .prepare('INSERT OR REPLACE INTO embedding_cache VALUES(?,?)')
    .run(embeddingKey(query), vectorBuffer(queryVector));
  const base = {
    text: 'historical validity test chunk',
    audience: 'public',
    version: 1,
    title: 'Validity · test',
    validFrom: '2026-01-01',
    validTo: null,
  };
  const expired = {
    ...base,
    id: 'chunk-expired-h',
    documentId: 'doc-expired-h',
    validTo: '2026-08-31',
    vector: queryVector,
  } as Chunk;
  const current = {
    ...base,
    id: 'chunk-current-h',
    documentId: 'doc-current-h',
    validTo: null,
    vector: queryVector.map((v) => v * 0.5),
  } as Chunk;
  const future = {
    ...base,
    id: 'chunk-future-h',
    documentId: 'doc-future-h',
    validFrom: '2026-10-01',
    vector: queryVector.map((v) => v * 0.4),
  } as Chunk;
  replaceChunks([expired, current, future], { model: config.embeddingModel, dimensions });
  const results = await searchDocuments(query, 'customer', 5, { includeExpired: true });
  // Ended validity windows are returned (best score first); a not-yet-valid
  // document is still excluded: it never applied.
  assert.deepEqual(
    results.map((r) => r.documentId),
    ['doc-expired-h', 'doc-current-h'],
  );
  assert.equal(results[0].validTo, '2026-08-31');
});

test('the historical-intent classifier is conservative and deterministic', async () => {
  const { isHistoricalQuery } = await import('../src/retrieval/search');
  const historical = [
    'What was the Aurora monthly fee before September 2026?',
    'What did the terms say prior to the change?',
    'Did the policy previously include a waiver?',
    'What was formerly included in the plan?',
    'I used to pay a lower fee.',
    'Is that perk no longer offered?',
    'What was the old monthly fee?',
    'Are there older versions of this document?',
    'What were the historical interest rates?',
    'Can you check the archive for the previous price?',
    'What was the fee last year?',
    'What did it cost last month?',
    'Was it different in 2025?',
    'How much did it cost in 2024?',
  ];
  for (const query of historical)
    assert.equal(isHistoricalQuery(query), true, `should be historical: ${query}`);
  const current = [
    'What is the Aurora monthly fee?',
    'How do I open a Horizon account?',
    'What is the maximum transfer amount?',
    'How do I unfreeze my card?',
    'Which documents apply today?',
    'What is the limit for card payments?',
  ];
  for (const query of current)
    assert.equal(isHistoricalQuery(query), false, `should not be historical: ${query}`);
  // Pure function: same input, same verdict.
  assert.equal(isHistoricalQuery('before'), isHistoricalQuery('before'));
});

const hasOpenAIKey = !!process.env.OPENAI_API_KEY?.trim();
const apiTest = hasOpenAIKey ? test : test.skip;

apiTest('a product-name query ranks the right product first', async () => {
  seedApp();
  // The corpus shares long boilerplate across all documents; the embedded
  // document prefix must let the product identity decide the ranking.
  for (const [query, product] of [
    // The live product-name check: the top hit must be about Community, not
    // another product (notice-community and community-* are both Community).
    ['Community account', 'community'],
    ['What is the monthly fee of the Community account?', 'community-fees'],
    ['What is the monthly fee of the Aurora account?', 'aurora-fees'],
  ] as const) {
    const results = await searchDocuments(query, 'customer', 5);
    assert.match(
      results[0].documentId,
      new RegExp(product),
      `"${query}" should rank ${product} first, got ${results.map((r) => r.documentId).join(', ')}`,
    );
  }
});

apiTest('a historical Aurora question retrieves the archived EUR 8 fee', async () => {
  seedApp();
  const historical = 'What was the Aurora account monthly fee before September 2026?';
  const { isHistoricalQuery } = await import('../src/retrieval/search');
  assert.equal(isHistoricalQuery(historical), true);
  const archived = await searchDocuments(historical, 'customer', 5, {
    includeExpired: isHistoricalQuery(historical),
  });
  const source = archived.find((r) => r.documentId.startsWith('archive-aurora'));
  assert.ok(source, `expected an archive-aurora source, got ${archived.map((r) => r.documentId).join(', ')}`);
  assert.match(source.text, /EUR 8/);
  assert.equal(source.validTo, '2026-08-31');
  assert.ok(source.validTo! < '2026-09-24');
  // Without the flag the archives stay excluded, as before.
  const inForceOnly = await searchDocuments(historical, 'customer', 5);
  assert.ok(inForceOnly.every((r) => !r.documentId.startsWith('archive-')));
});

test('search_documents passes the historical classifier verdict to the search', async () => {
  seedApp();
  const vector = Array.from({ length: dimensions }, (_, i) => (i === 0 ? 1 : 0));
  const base = {
    text: 'tool passthrough chunk',
    audience: 'public',
    version: 1,
    title: 'Passthrough · test',
    validFrom: '2026-01-01',
    validTo: null,
  };
  replaceChunks(
    [
      {
        ...base,
        id: 'chunk-tool-expired',
        documentId: 'doc-tool-expired',
        validTo: '2026-08-31',
        vector,
      } as Chunk,
      {
        ...base,
        id: 'chunk-tool-current',
        documentId: 'doc-tool-current',
        validTo: null,
        vector: vector.map((v) => v * 0.5),
      } as Chunk,
    ],
    { model: config.embeddingModel, dimensions },
  );
  // Stub the embeddings endpoint so the tool path runs without the network.
  const originalFetch = globalThis.fetch;
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-key';
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes('/embeddings'))
      return new Response(
        JSON.stringify({
          object: 'list',
          model: 'test-model',
          data: [{ object: 'embedding', index: 0, embedding: vector }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    return originalFetch(input, init);
  }) as typeof fetch;
  try {
    const { runTool } = await import('../src/agent/tools');
    const ctx = {
      userId: 'lucia',
      conversationId: null,
      runId: 'run-search-tool',
      intentId: 'intent-search-tool',
    };
    const historical = (await runTool('search_documents',
      { query: 'What was the fee before August 2026?' },
      ctx as any,
    )) as any;
    assert.ok(
      historical.sources.some((s: any) => s.documentId === 'doc-tool-expired'),
      'historical query should surface the expired source',
    );
    const expiredSource = historical.sources.find((s: any) => s.documentId === 'doc-tool-expired');
    // The result keeps validity metadata so the model can label the source.
    assert.equal(expiredSource.validTo, '2026-08-31');
    assert.equal(expiredSource.validFrom, '2026-01-01');
    assert.equal(expiredSource.version, 1);
    const currentQuery = (await runTool('search_documents',
      { query: 'What is the fee today?' },
      ctx as any,
    )) as any;
    assert.ok(
      currentQuery.sources.every((s: any) => s.documentId !== 'doc-tool-expired'),
      'current query must exclude the expired source',
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});

test('knowledge instructions require citations and forbid invented answers', async () => {
  const { knowledgeInstructions } = await import('../src/agent/prompt');
  const sources: (Chunk & { score: number })[] = [
    {
      id: 'chunk-1',
      documentId: 'aurora-fees',
      text: 'The Aurora monthly fee is waived when the balance stays above 500 euros.',
      title: 'Aurora · fees',
      version: 2,
      validFrom: '2026-01-01',
      validTo: null,
      audience: 'public',
      score: 0.9,
    },
  ];
  const instructions = knowledgeInstructions(sources);
  // Citations are mandatory for policy claims, with the token format the UI renders.
  assert.match(instructions, /\[documentId vVersion\]/);
  assert.match(instructions, /citation/i);
  assert.match(instructions, /every factual claim/i);
  // Gap filling with banking folklore is gone.
  assert.doesNotMatch(instructions, /common banking practices/i);
  assert.doesNotMatch(instructions, /concrete estimate/i);
  assert.match(instructions, /[Nn]ever invent/);
  assert.match(instructions, /no applicable documentation/i);
  // Sources must carry version and validity metadata so citations stay accurate.
  assert.match(instructions, /"validFrom":"2026-01-01"/);
  assert.match(instructions, /"version":2/);
  // In-force sources take precedence over background knowledge.
  assert.match(instructions, /reference date/);
  assert.match(instructions, /[Pp]recedence|[Pp]referred/);
  // Pending transfers must be described as proposals, never as executed operations.
  assert.match(instructions, /requires_confirmation/);
  assert.match(instructions, /NOT been executed/i);
  // A complete transfer request must produce a real tool call in the same turn,
  // never a prose-only 'proposal' asking the customer to confirm nothing.
  assert.match(instructions, /MUST call the transfer_money tool in that same turn/i);
  assert.match(instructions, /never ask the customer to confirm a transfer you have not created/i);
  // Asking first is reserved for genuinely missing details.
  assert.match(instructions, /ONLY when a required detail is genuinely missing/i);
  // The confirmation card is automatic from the tool result; the agent never invents it.
  assert.match(instructions, /confirmation card/i);
  assert.match(instructions, /Never invent an approval/i);
  // Citations are scoped to documentation claims, never transfer/tool statements.
  assert.match(instructions, /do NOT attach \[docId vN\] tokens to transfer or tool statements/i);
});

test('knowledge instructions label expired sources as historical and prefer in-force ones', async () => {
  const { knowledgeInstructions } = await import('../src/agent/prompt');
  const mkSource = (documentId: string, validTo: string | null) =>
    ({
      id: `chunk-${documentId}`,
      documentId,
      text: `The Aurora monthly fee is EUR 8 per month (${documentId}).`,
      title: 'Aurora · archived conditions',
      version: 1,
      validFrom: '2026-01-01',
      validTo,
      audience: 'public',
      score: 0.9,
    }) as Chunk & { score: number };
  const instructions = knowledgeInstructions([
    mkSource('archive-aurora-1', '2026-08-31'),
    mkSource('aurora-fees-2026', null),
  ]);
  // Expired sources are explicitly historical and no longer in force.
  assert.match(instructions, /historical and no longer in force/i);
  assert.match(instructions, /"inForce":false/);
  assert.match(instructions, /"inForce":true/);
  // The in-force value must come first when both exist.
  assert.match(instructions, /present the in-force value first/i);
  // Historical fee questions come from documentation, not fee_status.
  assert.match(instructions, /Historical fee questions are answered from documentation/i);
  // The model is told search_documents also covers archived documentation.
  assert.match(instructions, /archived documentation/i);
  // When the fee check does not cover an account, the published fee from the
  // in-force documentation is the fallback, not an invented number.
  assert.match(instructions, /published product fee/i);
});

test('search without an API key returns actionable configuration guidance', async () => {
  seedApp();
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = ' ';
  try {
    const { POST } = await import('../app/api/[...path]/route');
    const response = await POST(
      new Request('http://localhost/api/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: `banana_actor=${sessionToken('lucia')}`,
        },
        body: JSON.stringify({ query: `configuration-check-${Date.now()}` }),
      }),
      { params: Promise.resolve({ path: ['search'] }) },
    );
    assert.equal(response.status, 503);
    const result = await response.json();
    assert.equal(result.code, 'missing_openai_api_key');
    assert.match(result.error, /OPENAI_API_KEY/);
    assert.match(result.error, /restart/);
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});
type FakeBankResponse = { status: number; payload?: unknown; raw?: boolean };
/**
 * Minimal in-process bank double implementing the documented contract so the
 * application-level transfer path can be tested without live services. The
 * idempotency key is actor+reference; behaviors decide when effects commit.
 */
function startFakeBank() {
  const requests: Array<{ method: string; path: string; actor: string; body: any }> = [];
  const operations = new Map<string, any>();
  const behavior = {
    transfer: null as null | ((body: any, commit: () => void, replay: boolean) => FakeBankResponse),
    lookup: null as null | ((reference: string) => FakeBankResponse),
    operator: null as null | (() => FakeBankResponse),
    contacts: null as null | (() => FakeBankResponse),
    accounts: null as null | (() => FakeBankResponse),
    movements: null as null | (() => FakeBankResponse),
  };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const requestPath = req.url ?? '';
      requests.push({
        method: req.method ?? '',
        path: requestPath,
        actor: String(req.headers['x-bank-actor'] ?? ''),
        body: raw ? JSON.parse(raw) : undefined,
      });
      const respond = ({ status, payload, raw }: FakeBankResponse) => {
        if (raw) {
          // A raw non-JSON body (e.g. an HTML error page from a proxy).
          res.writeHead(status, { 'Content-Type': 'text/html' });
          return res.end(String(payload ?? ''));
        }
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify(payload ?? (status < 400 ? {} : { error: 'Simulated bank failure.' })),
        );
      };
      const commit = (body: any) => {
        if (!operations.has(body.reference))
          operations.set(body.reference, {
            id: `op-${body.reference}`,
            userId: 'lucia',
            reference: body.reference,
            fromAccountId: body.fromAccountId,
            toAccountId: body.toAccountId,
            amountCents: body.amountCents,
            concept: body.concept,
            createdAt: new Date().toISOString(),
            status: 'completed',
          });
      };
      if (req.method === 'GET' && requestPath.startsWith('/v1/movements')) {
        if (behavior.movements) return respond(behavior.movements());
        return respond({ status: 200, payload: [] });
      }
      if (req.method === 'GET' && requestPath.startsWith('/v1/accounts')) {
        if (behavior.accounts) return respond(behavior.accounts());
        return respond({
          status: 200,
          payload: [
            {
              id: 'acc-lucia',
              userId: 'lucia',
              label: 'Everyday',
              iban: 'ES91 0000 0000 0000',
              balanceCents: 100000,
            },
          ],
        });
      }
      if (req.method === 'GET' && requestPath.startsWith('/v1/contacts')) {
        if (behavior.contacts) return respond(behavior.contacts());
        return respond({
          status: 200,
          payload: [{ id: 'acc-bruno', name: 'Bruno Vidal', label: 'Horizon' }],
        });
      }
      if (req.method === 'POST' && requestPath === '/v1/transfers') {
        const body = JSON.parse(raw);
        const replay = operations.has(body.reference);
        if (behavior.transfer) return respond(behavior.transfer(body, () => commit(body), replay));
        commit(body);
        return respond({
          status: 200,
          payload: { ...operations.get(body.reference), ...(replay ? { replay: true } : {}) },
        });
      }
      if (req.method === 'GET' && requestPath.startsWith('/v1/operations/')) {
        const reference = decodeURIComponent(requestPath.slice('/v1/operations/'.length));
        if (behavior.lookup) return respond(behavior.lookup(reference));
        const operation = operations.get(reference);
        return operation
          ? respond({ status: 200, payload: operation })
          : respond({ status: 404, payload: { error: 'Not found.' } });
      }
      if (req.method === 'GET' && requestPath.startsWith('/v1/operator/customer')) {
        if (behavior.operator) return respond(behavior.operator());
        const customer = new URL(requestPath, 'http://bank.local').searchParams.get('id') ?? '';
        return respond({
          status: 200,
          payload: {
            accounts: [
              {
                id: `acc-${customer}`,
                userId: customer,
                label: 'Everyday',
                iban: 'ES91 0000 0000 0000',
                balanceCents: 50000,
              },
            ],
            operations: [...operations.values()].filter((o) => o.userId === customer),
          },
        });
      }
      return respond({ status: 404, payload: { error: 'Unknown endpoint.' } });
    });
  });
  return { server, requests, operations, behavior };
}

// --- Application-level transfer idempotency (double-debit regression) ---
const { config } = await import('../src/config');
const fakeBank = startFakeBank();
const originalBankUrl = config.bankUrl;
const fakeBankUrl = await new Promise<string>((resolve) => {
  fakeBank.server.listen(0, '127.0.0.1', () =>
    resolve(`http://127.0.0.1:${(fakeBank.server.address() as any).port}`),
  );
});
config.bankUrl = fakeBankUrl;
const { transferMoney } = await import('../src/banking/actions');
const transferContext = (intentId: string) => ({
  userId: 'lucia',
  conversationId: null,
  runId: `run-${intentId}`,
  intentId,
});
const intentRow = (intentId: string) =>
  appDb().prepare('SELECT * FROM intents WHERE id=?').get(intentId) as any;
after(() => {
  config.bankUrl = originalBankUrl;
  fakeBank.server.close();
});

test('a committed transfer with a lost response is debited exactly once', async () => {
  seedApp();
  fakeBank.operations.clear();
  fakeBank.requests.length = 0;
  fakeBank.behavior.transfer = (body, commit, replay) => {
    commit();
    if (replay)
      return { status: 200, payload: { ...fakeBank.operations.get(body.reference), replay: true } };
    return { status: 504 };
  };
  const intentId = 'intent-lost-response';
  const proposal = (await transferMoney(transferContext(intentId), input)) as any;
  assert.equal(proposal.status, 'requires_confirmation');
  const first = await transferMoney(
    { ...transferContext(intentId), approvalId: proposal.approvalId },
    input,
  );
  const retry = await transferMoney(transferContext(intentId), input);
  assert.equal(first.status, 'completed');
  assert.equal(retry.status, 'completed');
  assert.equal(fakeBank.operations.size, 1);
  const posts = fakeBank.requests.filter((r) => r.method === 'POST' && r.path === '/v1/transfers');
  assert.equal(posts.length, 2); // lost response + in-loop replay retry, nothing more
  assert.equal(posts[0].body.reference, posts[1].body.reference);
  assert.equal(intentRow(intentId).bank_reference, posts[0].body.reference);
});

test('a rejection before commit is reported as failed after verified absence', async () => {
  seedApp();
  fakeBank.operations.clear();
  fakeBank.requests.length = 0;
  fakeBank.behavior.transfer = () => ({ status: 503 });
  const intentId = 'intent-reject-before';
  const proposal = (await transferMoney(transferContext(intentId), input)) as any;
  assert.equal(proposal.status, 'requires_confirmation');
  const result = await transferMoney(
    { ...transferContext(intentId), approvalId: proposal.approvalId },
    input,
  );
  assert.equal(result.status, 'failed');
  assert.equal(intentRow(intentId).status, 'failed');
  assert.equal(fakeBank.operations.size, 0);
});

test('a committed operation unreachable through dispatch is recovered by reconciliation', async () => {
  seedApp();
  fakeBank.operations.clear();
  fakeBank.requests.length = 0;
  fakeBank.behavior.transfer = (body, commit) => {
    commit();
    return { status: 504 };
  };
  const intentId = 'intent-reconcile-found';
  const proposal = (await transferMoney(transferContext(intentId), input)) as any;
  assert.equal(proposal.status, 'requires_confirmation');
  const result = await transferMoney(
    { ...transferContext(intentId), approvalId: proposal.approvalId },
    input,
  );
  assert.equal(result.status, 'completed');
  assert.equal(intentRow(intentId).status, 'completed');
});

test('an unverifiable outcome stays processing and is never reported failed', async () => {
  seedApp();
  fakeBank.operations.clear();
  fakeBank.requests.length = 0;
  fakeBank.behavior.transfer = (body, commit) => {
    commit();
    return { status: 504 };
  };
  fakeBank.behavior.lookup = () => ({ status: 503 });
  const intentId = 'intent-unverified';
  const proposal = (await transferMoney(transferContext(intentId), input)) as any;
  assert.equal(proposal.status, 'requires_confirmation');
  const result = await transferMoney(
    { ...transferContext(intentId), approvalId: proposal.approvalId },
    input,
  );
  assert.equal(result.status, 'processing');
  assert.ok(String((result as any).message).length > 0);
  assert.equal(intentRow(intentId).status, 'processing');
  const posts = fakeBank.requests.filter(
    (r) => r.method === 'POST' && r.path === '/v1/transfers',
  ).length;
  // A processing intent must not re-dispatch on retry: only reconcile.
  const retry = await transferMoney(transferContext(intentId), input);
  assert.equal(retry.status, 'processing');
  assert.equal(
    fakeBank.requests.filter((r) => r.method === 'POST' && r.path === '/v1/transfers').length,
    posts,
  );
});

// --- Confirmation flow (sensitive operations require explicit approval) ---
const resetApprovalBehavior = () => {
  fakeBank.behavior.transfer = null;
  fakeBank.behavior.lookup = null;
  fakeBank.behavior.operator = null;
  fakeBank.behavior.contacts = null;
};
const transferPosts = () =>
  fakeBank.requests.filter((r) => r.method === 'POST' && r.path === '/v1/transfers').length;
const confirmResponse = async (approvalId: string) => {
  const { POST } = await import('../app/api/[...path]/route');
  return POST(
    new Request(`http://localhost/api/approvals/${approvalId}/confirm`, {
      method: 'POST',
      headers: { cookie: `banana_actor=${sessionToken('lucia')}` },
    }),
    { params: Promise.resolve({ path: ['approvals', approvalId, 'confirm'] }) },
  );
};
const cancelResponse = async (approvalId: string, user = 'lucia') => {
  const { POST } = await import('../app/api/[...path]/route');
  return POST(
    new Request(`http://localhost/api/approvals/${approvalId}/cancel`, {
      method: 'POST',
      headers: { cookie: `banana_actor=${sessionToken(user)}` },
    }),
    { params: Promise.resolve({ path: ['approvals', approvalId, 'cancel'] }) },
  );
};
const dashboardResponse = async () => {
  const { GET } = await import('../app/api/[...path]/route');
  return GET(
    new Request('http://localhost/api/dashboard', {
      headers: { cookie: `banana_actor=${sessionToken('lucia')}` },
    }),
    { params: Promise.resolve({ path: ['dashboard'] }) },
  );
};

test('an agent-initiated transfer proposes confirmation instead of dispatching', async () => {
  seedApp();
  fakeBank.operations.clear();
  fakeBank.requests.length = 0;
  resetApprovalBehavior();
  const intentId = 'intent-unconfirmed';
  const result = (await transferMoney(transferContext(intentId), input)) as any;
  assert.equal(result.status, 'requires_confirmation');
  assert.ok(typeof result.approvalId === 'string' && result.approvalId.length > 0);
  assert.ok(typeof result.expiresAt === 'string');
  assert.deepEqual(result.proposal, input);
  assert.equal(transferPosts(), 0);
  assert.equal(intentRow(intentId).status, 'created');

  // A retry of the same intent must return the same pending proposal.
  const retry = (await transferMoney(transferContext(intentId), input)) as any;
  assert.equal(retry.status, 'requires_confirmation');
  assert.equal(retry.approvalId, result.approvalId);
  assert.equal(
    (
      appDb().prepare('SELECT COUNT(*) n FROM approvals WHERE intent_id=?').get(intentId) as {
        n: number;
      }
    ).n,
    1,
  );
});

test('confirming a proposal dispatches exactly one transfer and consumes the approval', async () => {
  seedApp();
  fakeBank.operations.clear();
  fakeBank.requests.length = 0;
  resetApprovalBehavior();
  const intentId = 'intent-confirmed';
  const proposal = (await transferMoney(transferContext(intentId), input)) as any;
  const confirmed = await transferMoney(
    { ...transferContext(intentId), approvalId: proposal.approvalId },
    input,
  );
  assert.equal(confirmed.status, 'completed');
  assert.equal(fakeBank.operations.size, 1);
  assert.equal(transferPosts(), 1);
  const approval = appDb()
    .prepare('SELECT consumed_at FROM approvals WHERE id=?')
    .get(proposal.approvalId) as any;
  assert.ok(approval.consumed_at);
});

test('confirming the same proposal twice is rejected with 409 and debits once', async () => {
  seedApp();
  fakeBank.operations.clear();
  fakeBank.requests.length = 0;
  resetApprovalBehavior();
  const intentId = 'intent-double-confirm';
  const proposal = (await transferMoney(transferContext(intentId), input)) as any;
  const first = await confirmResponse(proposal.approvalId);
  assert.equal(first.status, 200);
  assert.equal((await first.json()).status, 'completed');
  const second = await confirmResponse(proposal.approvalId);
  assert.equal(second.status, 409);
  assert.equal(transferPosts(), 1);
});

test('confirming an expired proposal is rejected with 410', async () => {
  seedApp();
  fakeBank.operations.clear();
  fakeBank.requests.length = 0;
  resetApprovalBehavior();
  const intentId = 'intent-expired';
  const proposal = (await transferMoney(transferContext(intentId), input)) as any;
  appDb()
    .prepare('UPDATE approvals SET expires_at=? WHERE id=?')
    .run(new Date(Date.now() - 1000).toISOString(), proposal.approvalId);
  const response = await confirmResponse(proposal.approvalId);
  assert.equal(response.status, 410);
  assert.equal(transferPosts(), 0);
});

test('confirming an approval whose stored payload was tampered with is rejected with 409', async () => {
  seedApp();
  fakeBank.operations.clear();
  fakeBank.requests.length = 0;
  resetApprovalBehavior();
  const intentId = 'intent-tampered';
  const proposal = (await transferMoney(transferContext(intentId), input)) as any;
  appDb()
    .prepare('UPDATE approvals SET payload=? WHERE id=?')
    .run(JSON.stringify({ ...input, amountCents: 999 }), proposal.approvalId);
  await assert.rejects(
    () => transferMoney({ ...transferContext(intentId), approvalId: proposal.approvalId }, input),
    (e: unknown) => e instanceof HttpError && e.status === 409 && /does not match/i.test(e.message),
  );
  assert.equal(transferPosts(), 0);
});

// --- Cancellation: discarding a proposal must kill it server-side ---
test('cancelling a proposal marks it cancelled and removes it from conversation and dashboard', async () => {
  seedApp();
  fakeBank.operations.clear();
  fakeBank.requests.length = 0;
  resetApprovalBehavior();
  const conversationId = 'conv-cancel';
  createConversation(conversationId, 'Cancel');
  const proposal = await conversationProposal(conversationId, 'intent-cancel');

  const response = await cancelResponse(proposal.approvalId);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'cancelled' });
  const row = appDb()
    .prepare('SELECT cancelled_at FROM approvals WHERE id=?')
    .get(proposal.approvalId) as any;
  assert.ok(row.cancelled_at);

  const conversation = await (await conversationResponse(conversationId)).json();
  assert.deepEqual(conversation.pendingApprovals, []);
  const dashboard = await (await dashboardResponse()).json();
  assert.deepEqual(dashboard.approvals, []);
});

test('confirming a cancelled proposal is rejected with 409 and dispatches no transfer', async () => {
  seedApp();
  fakeBank.operations.clear();
  fakeBank.requests.length = 0;
  resetApprovalBehavior();
  const intentId = 'intent-cancel-then-confirm';
  const proposal = (await transferMoney(transferContext(intentId), input)) as any;
  assert.equal((await cancelResponse(proposal.approvalId)).status, 200);

  const response = await confirmResponse(proposal.approvalId);
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /cancelled/i);
  assert.equal(transferPosts(), 0);

  // A cancelled proposal must never be reused by an agent retry: the retry
  // creates a fresh proposal instead of returning the cancelled one.
  const retry = (await transferMoney(transferContext(intentId), input)) as any;
  assert.equal(retry.status, 'requires_confirmation');
  assert.notEqual(retry.approvalId, proposal.approvalId);
});

test('cancelling a proposal twice is idempotent', async () => {
  seedApp();
  resetApprovalBehavior();
  const proposal = (await transferMoney(transferContext('intent-cancel-twice'), input)) as any;
  const first = await cancelResponse(proposal.approvalId);
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { status: 'cancelled' });
  const second = await cancelResponse(proposal.approvalId);
  assert.equal(second.status, 200);
  assert.deepEqual(await second.json(), { status: 'cancelled' });
});

test('cancelling another user\'s approval is not found', async () => {
  seedApp();
  resetApprovalBehavior();
  const proposal = (await transferMoney(transferContext('intent-cancel-foreign'), input)) as any;
  const response = await cancelResponse(proposal.approvalId, 'bruno');
  assert.equal(response.status, 404);
  // The owner can still confirm it: nothing was cancelled.
  const row = appDb()
    .prepare('SELECT cancelled_at FROM approvals WHERE id=?')
    .get(proposal.approvalId) as any;
  assert.equal(row.cancelled_at, null);
});

// --- Conversation loop closure: pending proposals in chat, receipt message ---
const conversationResponse = async (conversationId: string) => {
  const { GET } = await import('../app/api/[...path]/route');
  return GET(
    new Request(`http://localhost/api/conversations/${conversationId}`, {
      headers: { cookie: `banana_actor=${sessionToken('lucia')}` },
    }),
    { params: Promise.resolve({ path: ['conversations', conversationId] }) },
  );
};
const conversationProposal = async (conversationId: string, intentId: string, payload = input) =>
  (await transferMoney(
    { userId: 'lucia', conversationId, runId: `run-${intentId}`, intentId },
    payload,
  )) as any;
const receiptCount = (conversationId: string) =>
  (
    appDb()
      .prepare(
        "SELECT COUNT(*) n FROM messages WHERE conversation_id=? AND role='assistant' AND content LIKE 'Transfer completed:%'",
      )
      .get(conversationId) as { n: number }
  ).n;
const createConversation = (id: string, title: string) =>
  appDb()
    .prepare('INSERT INTO conversations VALUES(?,?,?,?)')
    .run(id, 'lucia', title, new Date().toISOString());

test('conversation GET returns pendingApprovals and excludes consumed or expired ones', async () => {
  seedApp();
  fakeBank.operations.clear();
  fakeBank.requests.length = 0;
  resetApprovalBehavior();
  const conversationId = 'conv-pending-approvals';
  createConversation(conversationId, 'Pending approvals');
  const proposal = await conversationProposal(conversationId, 'intent-pending');
  assert.equal(proposal.status, 'requires_confirmation');

  const response = await conversationResponse(conversationId);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.pendingApprovals, [
    {
      id: proposal.approvalId,
      intent_id: 'intent-pending',
      expires_at: proposal.expiresAt,
      payload: input,
    },
  ]);

  // Expired proposals are no longer pending.
  appDb()
    .prepare('UPDATE approvals SET expires_at=? WHERE id=?')
    .run(new Date(Date.now() - 1000).toISOString(), proposal.approvalId);
  const expired = await (await conversationResponse(conversationId)).json();
  assert.deepEqual(expired.pendingApprovals, []);

  // Consumed proposals are no longer pending either.
  appDb()
    .prepare('UPDATE approvals SET expires_at=?, consumed_at=? WHERE id=?')
    .run(new Date(Date.now() + 60000).toISOString(), new Date().toISOString(), proposal.approvalId);
  const consumed = await (await conversationResponse(conversationId)).json();
  assert.deepEqual(consumed.pendingApprovals, []);
});

test('confirming from a conversation appends exactly one receipt message; a repeated confirm appends nothing', async () => {
  seedApp();
  fakeBank.operations.clear();
  fakeBank.requests.length = 0;
  resetApprovalBehavior();
  const conversationId = 'conv-receipt';
  createConversation(conversationId, 'Receipt');
  const proposal = await conversationProposal(conversationId, 'intent-receipt');
  assert.equal(receiptCount(conversationId), 0);

  const confirmed = await confirmResponse(proposal.approvalId);
  assert.equal(confirmed.status, 200);
  const result = await confirmed.json();
  assert.equal(result.status, 'completed');

  const after = await (await conversationResponse(conversationId)).json();
  const last = (after.messages as any[]).at(-1);
  assert.equal(last.role, 'assistant');
  // Labels come from the bank's account and contact records, never invented.
  assert.equal(
    last.content,
    `Transfer completed: EUR 10.00 from your Everyday to Bruno Vidal's Horizon (concept: Test). Reference: ${result.operation.reference}.`,
  );
  assert.equal(receiptCount(conversationId), 1);

  // The second confirm is rejected with 409 and appends no extra message.
  const second = await confirmResponse(proposal.approvalId);
  assert.equal(second.status, 409);
  assert.equal(receiptCount(conversationId), 1);
  const afterSecond = await (await conversationResponse(conversationId)).json();
  assert.equal((afterSecond.messages as any[]).at(-1).id, last.id);
});

test('the receipt falls back to account ids when the bank label lookup fails', async () => {
  seedApp();
  fakeBank.operations.clear();
  fakeBank.requests.length = 0;
  resetApprovalBehavior();
  fakeBank.behavior.contacts = () => ({ status: 503 });
  try {
    const conversationId = 'conv-receipt-fallback';
    createConversation(conversationId, 'Receipt fallback');
    const proposal = await conversationProposal(conversationId, 'intent-receipt-fb');
    const confirmed = await confirmResponse(proposal.approvalId);
    assert.equal(confirmed.status, 200);
    const result = await confirmed.json();
    const after = await (await conversationResponse(conversationId)).json();
    const last = (after.messages as any[]).at(-1);
    assert.equal(
      last.content,
      `Transfer completed: EUR 10.00 from your acc-lucia to acc-bruno (concept: Test). Reference: ${result.operation.reference}.`,
    );
    // No invented names when the lookup fails.
    assert.doesNotMatch(last.content, /Everyday|Bruno Vidal|Horizon/);
  } finally {
    fakeBank.behavior.contacts = null;
  }
});

// --- Cancellation loop closure: a discarded proposal leaves a chat message ---
const cancelCount = (conversationId: string) =>
  (
    appDb()
      .prepare(
        "SELECT COUNT(*) n FROM messages WHERE conversation_id=? AND role='assistant' AND content LIKE 'Transfer cancelled:%'",
      )
      .get(conversationId) as { n: number }
  ).n;

test('cancelling from a conversation appends exactly one cancellation message; re-cancelling appends nothing', async () => {
  seedApp();
  fakeBank.operations.clear();
  fakeBank.requests.length = 0;
  resetApprovalBehavior();
  const conversationId = 'conv-cancel-message';
  createConversation(conversationId, 'Cancel message');
  const proposal = await conversationProposal(conversationId, 'intent-cancel-message');
  assert.equal(cancelCount(conversationId), 0);

  const first = await cancelResponse(proposal.approvalId);
  assert.equal(first.status, 200);
  const after = await (await conversationResponse(conversationId)).json();
  const last = (after.messages as any[]).at(-1);
  assert.equal(last.role, 'assistant');
  // Labels come from the bank's records; the message is built only from the
  // stored payload, never from a bank operation (none exists for a cancel).
  assert.equal(
    last.content,
    `Transfer cancelled: EUR 10.00 from your Everyday to Bruno Vidal's Horizon (concept: Test) was not sent. No money has moved.`,
  );
  assert.equal(cancelCount(conversationId), 1);
  assert.deepEqual(after.pendingApprovals, []);

  // The idempotent re-cancel must not append a duplicate message.
  const second = await cancelResponse(proposal.approvalId);
  assert.equal(second.status, 200);
  assert.equal(cancelCount(conversationId), 1);
  const afterSecond = await (await conversationResponse(conversationId)).json();
  assert.equal((afterSecond.messages as any[]).at(-1).id, last.id);
});

test('cancelling an approval whose intent has no conversation appends no message and still succeeds', async () => {
  seedApp();
  fakeBank.operations.clear();
  fakeBank.requests.length = 0;
  resetApprovalBehavior();
  const totalCancellations = () =>
    (
      appDb()
        .prepare(
          "SELECT COUNT(*) n FROM messages WHERE role='assistant' AND content LIKE 'Transfer cancelled:%'",
        )
        .get() as { n: number }
    ).n;
  const before = totalCancellations();
  const proposal = (await transferMoney(transferContext('intent-cancel-no-conv'), input)) as any;
  assert.equal(proposal.status, 'requires_confirmation');
  assert.equal(intentRow('intent-cancel-no-conv').conversation_id, null);

  const response = await cancelResponse(proposal.approvalId);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'cancelled' });
  assert.equal(totalCancellations(), before);
});

test('the cancellation message falls back to account ids when the label lookup fails', async () => {
  seedApp();
  fakeBank.operations.clear();
  fakeBank.requests.length = 0;
  resetApprovalBehavior();
  fakeBank.behavior.contacts = () => ({ status: 503 });
  try {
    const conversationId = 'conv-cancel-fallback';
    createConversation(conversationId, 'Cancel fallback');
    const proposal = await conversationProposal(conversationId, 'intent-cancel-fb');
    const response = await cancelResponse(proposal.approvalId);
    assert.equal(response.status, 200);
    const after = await (await conversationResponse(conversationId)).json();
    const last = (after.messages as any[]).at(-1);
    assert.equal(
      last.content,
      'Transfer cancelled: EUR 10.00 from your acc-lucia to acc-bruno (concept: Test) was not sent. No money has moved.',
    );
    // No invented names when the lookup fails.
    assert.doesNotMatch(last.content, /Everyday|Bruno Vidal|Horizon/);
  } finally {
    fakeBank.behavior.contacts = null;
  }
});

// --- One pending proposal per conversation: reuse and supersede ---
test('a different proposal in the same conversation supersedes the previous one', async () => {
  seedApp();
  fakeBank.operations.clear();
  fakeBank.requests.length = 0;
  resetApprovalBehavior();
  const conversationId = 'conv-supersede';
  createConversation(conversationId, 'Supersede');
  const first = await conversationProposal(conversationId, 'intent-supersede-a', input);
  const second = await conversationProposal(conversationId, 'intent-supersede-b', {
    ...input,
    amountCents: 2500,
    concept: 'Rent',
  });
  assert.equal(first.status, 'requires_confirmation');
  assert.equal(second.status, 'requires_confirmation');
  assert.notEqual(second.approvalId, first.approvalId);

  // The superseded proposal was cancelled silently, exactly once pending.
  const row = appDb()
    .prepare('SELECT cancelled_at FROM approvals WHERE id=?')
    .get(first.approvalId) as any;
  assert.ok(row.cancelled_at);
  const conversation = await (await conversationResponse(conversationId)).json();
  assert.deepEqual(
    (conversation.pendingApprovals as any[]).map((a) => a.id),
    [second.approvalId],
  );
  const dashboard = await (await dashboardResponse()).json();
  assert.deepEqual((dashboard.approvals as any[]).map((a) => a.id), [second.approvalId]);

  // Confirming the superseded proposal is refused and moves no money.
  const response = await confirmResponse(first.approvalId);
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /cancelled/i);
  assert.equal(transferPosts(), 0);
});

test('an identical repeat in the same conversation reuses the same approvalId', async () => {
  seedApp();
  fakeBank.operations.clear();
  fakeBank.requests.length = 0;
  resetApprovalBehavior();
  const conversationId = 'conv-reuse';
  createConversation(conversationId, 'Reuse');
  const first = await conversationProposal(conversationId, 'intent-reuse-a', input);
  const second = await conversationProposal(conversationId, 'intent-reuse-b', input);
  assert.equal(first.status, 'requires_confirmation');
  assert.equal(second.status, 'requires_confirmation');
  assert.equal(second.approvalId, first.approvalId);
  // No second row: the repeat is idempotent, not a new proposal.
  const count = (
    appDb()
      .prepare(
        'SELECT COUNT(*) n FROM approvals a JOIN intents i ON i.id=a.intent_id WHERE i.conversation_id=?',
      )
      .get(conversationId) as { n: number }
  ).n;
  assert.equal(count, 1);
});

test('proposals in different conversations do not affect each other', async () => {
  seedApp();
  fakeBank.operations.clear();
  fakeBank.requests.length = 0;
  resetApprovalBehavior();
  createConversation('conv-iso-a', 'Isolation A');
  createConversation('conv-iso-b', 'Isolation B');
  const a = await conversationProposal('conv-iso-a', 'intent-iso-a', input);
  const b = await conversationProposal('conv-iso-b', 'intent-iso-b', {
    ...input,
    amountCents: 2500,
  });
  const pendingIds = async (conversationId: string) =>
    ((await (await conversationResponse(conversationId)).json()).pendingApprovals as any[]).map(
      (x) => x.id,
    );
  assert.deepEqual(await pendingIds('conv-iso-a'), [a.approvalId]);
  assert.deepEqual(await pendingIds('conv-iso-b'), [b.approvalId]);

  // Confirming one leaves the other conversation's proposal untouched.
  const confirmed = await confirmResponse(a.approvalId);
  assert.equal(confirmed.status, 200);
  assert.deepEqual(await pendingIds('conv-iso-b'), [b.approvalId]);
  const dashboard = await (await dashboardResponse()).json();
  assert.deepEqual((dashboard.approvals as any[]).map((x) => x.id), [b.approvalId]);
});

test('proposals without a conversation are not superseded by each other', async () => {
  seedApp();
  fakeBank.operations.clear();
  fakeBank.requests.length = 0;
  resetApprovalBehavior();
  const first = (await transferMoney(transferContext('intent-noconv-a'), input)) as any;
  const second = (await transferMoney(transferContext('intent-noconv-b'), {
    ...input,
    amountCents: 2500,
  })) as any;
  assert.equal(first.status, 'requires_confirmation');
  assert.equal(second.status, 'requires_confirmation');
  // Without a conversation different payloads are never superseded: both stay pending.
  const rows = appDb()
    .prepare('SELECT cancelled_at FROM approvals WHERE user_id=? ORDER BY rowid')
    .all('lucia') as any[];
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.cancelled_at), [null, null]);
});

test('repeated form submits with the same payload and no conversation reuse one approval', async () => {
  seedApp();
  fakeBank.operations.clear();
  fakeBank.requests.length = 0;
  resetApprovalBehavior();
  // Two submissions of the same payload, each with its own intentId (exactly
  // what a double click produces when the client identity is missed).
  const first = (await transferMoney(transferContext('intent-form-a'), input)) as any;
  const second = (await transferMoney(transferContext('intent-form-b'), input)) as any;
  assert.equal(first.status, 'requires_confirmation');
  assert.equal(second.status, 'requires_confirmation');
  assert.equal(second.approvalId, first.approvalId);
  // Exactly one pending no-conversation proposal for this user.
  const pending = (
    appDb()
      .prepare(
        `SELECT COUNT(*) n FROM approvals a JOIN intents i ON i.id=a.intent_id
         WHERE a.user_id='lucia' AND i.conversation_id IS NULL
           AND a.consumed_at IS NULL AND a.cancelled_at IS NULL`,
      )
      .get() as { n: number }
  ).n;
  assert.equal(pending, 1);
  // A different payload creates a new proposal instead of reusing it.
  const third = (await transferMoney(transferContext('intent-form-c'), {
    ...input,
    amountCents: 2500,
  })) as any;
  assert.equal(third.status, 'requires_confirmation');
  assert.notEqual(third.approvalId, first.approvalId);
});

test('a non-JSON bank error body surfaces a clean BankError with the real status', async () => {
  fakeBank.behavior.accounts = () => ({
    status: 502,
    payload: '<html>502 Bad Gateway</html>',
    raw: true,
  });
  try {
    const { bankRequest, BankError } = await import('../src/banking/client');
    await assert.rejects(
      () => bankRequest('lucia', '/v1/accounts'),
      (e: unknown) =>
        e instanceof BankError &&
        e.status === 502 &&
        e.message === 'The bank returned a non-JSON response.',
    );
    // JSON error bodies keep the documented behaviour (status + data.error).
    fakeBank.behavior.accounts = () => ({ status: 503, payload: { error: 'Bank down.' } });
    await assert.rejects(
      () => bankRequest('lucia', '/v1/accounts'),
      (e: unknown) => e instanceof BankError && e.status === 503 && e.message === 'Bank down.',
    );
  } finally {
    fakeBank.behavior.accounts = null;
  }
});

test('GET /api/people succeeds without a session cookie (intentional public route)', async () => {
  const { GET } = await import('../app/api/[...path]/route');
  const response = await GET(
    new Request('http://localhost/api/people'),
    { params: Promise.resolve({ path: ['people'] }) },
  );
  assert.equal(response.status, 200);
  const body = (await response.json()) as any[];
  assert.ok(Array.isArray(body) && body.length > 0);
});

test('the agent run reports explicitly when it exhausts its tool rounds', async () => {
  seedApp();
  resetApprovalBehavior();
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-key';
  const originalFetch = globalThis.fetch;
  // The model keeps calling a tool forever, so the 7-round budget runs out.
  const responsePayload = {
    id: 'resp-incomplete-test',
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    status: 'completed',
    model: 'gpt-test',
    error: null,
    output: [
      {
        type: 'function_call',
        id: 'fc-1',
        call_id: 'call-1',
        name: 'list_accounts',
        arguments: '{}',
        status: 'completed',
      },
    ],
    usage: {
      input_tokens: 1,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens: 1,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: 2,
    },
  };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes('/responses'))
      return new Response(JSON.stringify(responsePayload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    return originalFetch(input, init);
  }) as typeof fetch;
  const conversationId = 'conv-incomplete';
  appDb()
    .prepare('INSERT INTO conversations VALUES(?,?,?,?)')
    .run(conversationId, 'lucia', 'Incomplete', new Date().toISOString());
  // Pre-cache the query embedding so searchDocuments needs no API call.
  const content = `incomplete-run-${Date.now()}`;
  appDb()
    .prepare('INSERT OR REPLACE INTO embedding_cache VALUES(?,?)')
    .run(
      embeddingKey(content),
      vectorBuffer(Array.from({ length: dimensions }, (_, i) => (i === 0 ? 1 : 0))),
    );
  try {
    const { sendMessage } = await import('../src/agent/run');
    const result = await sendMessage('lucia', conversationId, content);
    // The answer states the exhaustion explicitly and offers a next step.
    assert.match(result.answer, /could not complete/i);
    assert.match(result.answer, /within the allowed steps/i);
    assert.match(result.answer, /human support/i);
    // The event is recorded for the operator.
    const event = appDb()
      .prepare("SELECT * FROM events WHERE run_id=? AND kind='run.incomplete'")
      .get(result.runId) as any;
    assert.ok(event);
    assert.equal(JSON.parse(event.data).reason, 'rounds_exhausted');
    // The stored assistant message carries the same explicit answer.
    const last = appDb()
      .prepare(
        'SELECT content FROM messages WHERE conversation_id=? AND run_id=? ORDER BY rowid DESC',
      )
      .get(conversationId, result.runId) as any;
    assert.match(last.content, /within the allowed steps/i);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});

// --- Operator visibility: telemetry, case detail, case closure ---
const insertMessage = (
  id: string,
  conversationId: string,
  role: string,
  content: string,
  createdAt: string,
) =>
  appDb()
    .prepare('INSERT INTO messages VALUES(?,?,?,?,?,?)')
    .run(id, conversationId, role, content, createdAt, null);

const insertEvent = (
  id: string,
  conversationId: string,
  kind: string,
  data: unknown,
  createdAt: string,
) =>
  appDb()
    .prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?)')
    .run(id, `run-${id}`, 'lucia', conversationId, kind, JSON.stringify(data), createdAt);

const insertIncident = (id: string, conversationId: string, status: string) =>
  appDb()
    .prepare('INSERT INTO incidents VALUES(?,?,?,?,?,?)')
    .run(id, 'lucia', conversationId, 'Transfer help', status, new Date().toISOString());

test('recordEvent persists the full telemetry payload, not just tool and status', async () => {
  seedApp();
  const { recordEvent } = await import('../src/telemetry');
  recordEvent(
    {
      userId: 'lucia',
      conversationId: 'conv-telemetry',
      runId: 'run-telemetry',
      intentId: 'intent-telemetry',
    },
    'tool.completed',
    {
      tool: 'transfer_money',
      status: 'completed',
      arguments: { fromAccountId: 'acc-lucia', amountCents: 1000 },
      output: { status: 'requires_confirmation', approvalId: 'ap-1' },
      durationMs: 42,
    },
  );
  const row = appDb().prepare('SELECT * FROM events WHERE run_id=?').get('run-telemetry') as any;
  const data = JSON.parse(row.data);
  assert.equal(data.tool, 'transfer_money');
  assert.equal(data.status, 'completed');
  assert.deepEqual(data.arguments, { fromAccountId: 'acc-lucia', amountCents: 1000 });
  assert.deepEqual(data.output, { status: 'requires_confirmation', approvalId: 'ap-1' });
  assert.equal(data.durationMs, 42);
});

test('caseDetail returns real conversation evidence and bank operations via the operator endpoint', async () => {
  seedApp();
  fakeBank.operations.clear();
  fakeBank.requests.length = 0;
  resetApprovalBehavior();
  const conversationId = 'conv-case-detail';
  appDb()
    .prepare('INSERT INTO conversations VALUES(?,?,?,?)')
    .run(conversationId, 'lucia', 'Case detail', new Date().toISOString());
  insertMessage(
    'msg-cd-2',
    conversationId,
    'assistant',
    'Let me check that for you.',
    '2026-01-01T10:01:00.000Z',
  );
  insertMessage(
    'msg-cd-1',
    conversationId,
    'user',
    'I sent money but it disappeared.',
    '2026-01-01T10:00:00.000Z',
  );
  // Inserted last on purpose: ordering must follow created_at, not rowid.
  insertEvent(
    'evt-cd-1',
    conversationId,
    'tool.started',
    { tool: 'transfer_money', status: 'started', arguments: { amountCents: 100 } },
    '2026-01-01T10:02:00.000Z',
  );
  insertEvent(
    'evt-cd-2',
    conversationId,
    'tool.completed',
    {
      tool: 'transfer_money',
      status: 'completed',
      arguments: { amountCents: 100 },
      output: { status: 'requires_confirmation' },
      durationMs: 7,
    },
    '2026-01-01T10:02:01.000Z',
  );
  appDb()
    .prepare('INSERT INTO intents VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(
      'intent-cd',
      'lucia',
      conversationId,
      'run-cd',
      JSON.stringify(input),
      'completed',
      'ref-cd',
      'op-cd',
      null,
      '2026-01-01T10:02:02.000Z',
    );
  insertIncident('incident-cd', conversationId, 'open');
  fakeBank.operations.set('ref-cd', {
    id: 'op-cd',
    userId: 'lucia',
    reference: 'ref-cd',
    amountCents: 100,
    concept: 'Test',
    createdAt: '2026-01-01T10:02:03.000Z',
    status: 'completed',
  });
  const { caseDetail } = await import('../src/operator/view');
  const detail = await caseDetail('marta', 'incident-cd');
  assert.deepEqual(
    (detail.history as any[]).map((m) => m.id),
    ['msg-cd-1', 'msg-cd-2'],
  );
  assert.equal(detail.history[0].content, 'I sent money but it disappeared.');
  assert.deepEqual(
    (detail.events as any[]).map((e) => e.id),
    ['evt-cd-1', 'evt-cd-2'],
  );
  assert.equal(detail.events[1].data.durationMs, 7);
  assert.equal(detail.events[1].data.arguments.amountCents, 100);
  assert.equal(detail.intents.length, 1);
  assert.equal(detail.intents[0].bank_reference, 'ref-cd');
  assert.deepEqual(detail.intents[0].payload, input);
  assert.ok(detail.bank);
  assert.equal(detail.bank.operations.length, 1);
  assert.equal(detail.bank.operations[0].amountCents, 100);
  assert.equal(detail.bank.operations[0].reference, 'ref-cd');
  assert.equal(detail.bank.operations[0].status, 'completed');
  assert.equal(detail.gaps, '');
  const operatorRequest = fakeBank.requests.find((r) => r.path.startsWith('/v1/operator/customer'));
  assert.ok(operatorRequest);
  assert.equal(operatorRequest.actor, 'marta');
  assert.match(operatorRequest.path, /id=lucia/);
});

test('caseDetail reports honest gaps instead of inventing evidence', async () => {
  seedApp();
  resetApprovalBehavior();
  const conversationId = 'conv-gaps';
  appDb()
    .prepare('INSERT INTO conversations VALUES(?,?,?,?)')
    .run(conversationId, 'lucia', 'No activity', new Date().toISOString());
  insertMessage(
    'msg-gaps-1',
    conversationId,
    'user',
    'Where is my money?',
    '2026-01-01T11:00:00.000Z',
  );
  insertIncident('incident-gaps', conversationId, 'open');
  const { caseDetail } = await import('../src/operator/view');
  // No recorded events and the bank is unreachable: gaps, never fabricated rows.
  fakeBank.behavior.operator = () => ({ status: 503 });
  try {
    const detail = await caseDetail('marta', 'incident-gaps');
    assert.equal(detail.events.length, 0);
    assert.equal(detail.bank, null);
    assert.match(detail.gaps, /no agent activity/i);
    assert.match(detail.gaps, /bank operations could not be retrieved/i);
  } finally {
    fakeBank.behavior.operator = null;
  }
});

test('closing a case is operator-only, persists, and rejects unknown or repeated closures', async () => {
  seedApp();
  const { POST } = await import('../app/api/[...path]/route');
  const close = (incidentId: string, user = 'marta') =>
    POST(
      new Request(`http://localhost/api/incidents/${incidentId}/close`, {
        method: 'POST',
        headers: { cookie: `banana_actor=${sessionToken(user)}` },
      }),
      { params: Promise.resolve({ path: ['incidents', incidentId, 'close'] }) },
    );
  assert.equal((await close('incident-missing')).status, 404);
  const open = appDb().prepare("SELECT id FROM incidents WHERE status='open' LIMIT 1").get() as any;
  const response = await close(open.id, 'lucia');
  assert.equal(response.status, 403);
  const ok = await close(open.id);
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).status, 'closed');
  assert.equal(
    (appDb().prepare('SELECT status FROM incidents WHERE id=?').get(open.id) as any).status,
    'closed',
  );
  assert.equal((await close(open.id)).status, 409);
});

// --- Fee coach: deterministic fee engine (part 2) ---
const feeAccount = (id: string, label: string) => ({
  id,
  userId: 'lucia',
  label,
  iban: 'ES91 2100 0418 4500',
  balanceCents: 100000,
});
const feeMovement = (
  accountId: string,
  amountCents: number,
  description: string,
  day = 5,
): BankMovement => ({
  id: `mv-${accountId}-${description}-${amountCents}`,
  accountId,
  operationId: null,
  amountCents,
  description,
  createdAt: `2026-09-${String(day).padStart(2, '0')}T10:00:00.000Z`,
});
const cardPurchases = (accountId: string, n: number) =>
  Array.from({ length: n }, (_, i) =>
    feeMovement(
      accountId,
      -(1000 + i * 25),
      ['Groceries', 'Internet bill', 'Coffee shop', 'Transport', 'Pharmacy'][i],
      5 + i,
    ),
  );

// The evaluation month comes from the fixed reference date (2026-09-24), so
// these tests are deterministic regardless of the real wall clock.
test('the fee engine parses the fee from the text of each in-force fee document', () => {
  seedApp();
  const expected = [
    ['Aurora account', 'aurora-fees-2026', 600],
    ['Horizon account', 'horizon-fees-2026', 300],
    ['Cloud account', 'cloud-fees-2026', 0],
    ['Community account', 'community-fees-2026', 200],
    ['Family account', 'family-fees-2026', 500],
  ] as const;
  const result = evaluateFees({
    userId: 'lucia',
    accounts: expected.map(([label], i) => feeAccount(`acc-${i}`, label)),
    movements: [],
  });
  assert.equal(result.month, '2026-09');
  expected.forEach(([label, documentId, feeCents], i) => {
    const a = result.accounts[i];
    assert.equal(a.label, label);
    assert.equal(a.product, label.replace(/ account$/i, '').toLowerCase());
    assert.equal(a.status, 'decided');
    assert.equal(a.feeCents, feeCents);
    assert.equal(a.policy?.documentId, documentId);
    assert.equal(a.policy?.version, 2);
  });
  assert.equal(result.status, 'decided');
});

test('the salary waiver is detected from the document text for Aurora only', () => {
  seedApp();
  const result = evaluateFees({
    userId: 'lucia',
    accounts: [feeAccount('acc-a', 'Aurora account'), feeAccount('acc-h', 'Horizon account')],
    movements: [],
  });
  const [aurora, horizon] = result.accounts;
  assert.equal(aurora.conditions.length, 2);
  assert.match(aurora.conditions[0].name, /salary/i);
  assert.match(aurora.conditions[1].name, /purchase/i);
  assert.equal(horizon.conditions.length, 0);
  // The other documents only mention the waiver to say they do NOT use it.
  assert.ok(result.caveats.some((c) => /horizon/i.test(c) && /flat/i.test(c)));
});

test('conditions are evaluated against the month movements with quoted evidence', () => {
  seedApp();
  const run = (salaryCents: number | null, purchases: number, extra: BankMovement[] = []) =>
    evaluateFees({
      userId: 'lucia',
      accounts: [feeAccount('acc-a', 'Aurora account')],
      movements: [
        ...(salaryCents === null
          ? []
          : [feeMovement('acc-a', salaryCents, 'September salary', 2)]),
        ...cardPurchases('acc-a', purchases),
        ...extra,
      ],
    });
  const [salary, card] = [0, 1].map((i) => run(119_999, 3).accounts[0].conditions[i]);
  assert.equal(salary.met, false);
  assert.match(salary.evidence, /September salary/);
  assert.match(salary.evidence, /1,199\.99/);
  assert.equal(card.met, true);

  let r = run(175_000, 2);
  assert.equal(r.accounts[0].conditions[0].met, true);
  assert.match(r.accounts[0].conditions[0].evidence, /1,750\.00/);
  assert.equal(r.accounts[0].conditions[1].met, false);
  assert.equal(r.accounts[0].feeCents, 600);

  r = run(120_000, 3);
  assert.ok(r.accounts[0].conditions.every((c) => c.met));
  assert.equal(r.accounts[0].feeCents, 0);

  assert.equal(run(120_000, 0).accounts[0].conditions[1].met, false);
  r = run(120_000, 4);
  assert.equal(r.accounts[0].conditions[1].met, true);
  assert.match(r.accounts[0].conditions[1].evidence, /4/);

  // Transfers and the opening balance are not card purchases.
  r = run(120_000, 1, [
    feeMovement('acc-a', -5000, 'Transfer · Rent', 9),
    feeMovement('acc-a', 240000, 'Opening balance', 1),
  ]);
  assert.equal(r.accounts[0].conditions[1].met, false);
  assert.match(r.accounts[0].conditions[1].evidence, /1 card-like purchase/);
  assert.match(r.accounts[0].conditions[1].evidence, /Groceries/);

  // No salary at all: the condition is not met with honest evidence.
  const none = run(null, 4).accounts[0].conditions[0];
  assert.equal(none.met, false);
  assert.match(none.evidence, /no salary payment/i);
});

test('a product without an in-force fee policy stays undetermined without an invented fee', () => {
  seedApp();
  const result = evaluateFees({
    userId: 'lucia',
    accounts: [feeAccount('acc-s', 'Personal savings')],
    movements: [feeMovement('acc-s', 100, 'Interest')],
  });
  const a = result.accounts[0];
  assert.equal(a.status, 'undetermined');
  assert.equal(a.feeCents, null);
  assert.equal(a.policy, null);
  assert.match(a.reason!, /no in-force fee policy document/i);
  assert.equal(result.status, 'undetermined');
  assert.ok(result.caveats.some((c) => /Personal savings/i.test(c)));
});

test('an archived Aurora fee document is never selected for the current month', () => {
  seedApp();
  // The trap is really in the seeded index.
  assert.ok(allChunks().some((c) => c.documentId.startsWith('archive-aurora')));
  const result = evaluateFees({
    userId: 'lucia',
    accounts: [feeAccount('acc-a', 'Aurora account')],
    movements: [],
  });
  assert.equal(result.accounts[0].policy?.documentId, 'aurora-fees-2026');
  assert.notEqual(result.accounts[0].feeCents, 800);
  assert.equal(result.accounts[0].feeCents, 600);
});

test('a waiver mention that cannot be parsed stays undetermined instead of guessing', () => {
  seedApp();
  const vector = Array.from({ length: dimensions }, (_, i) => (i === 0 ? 1 : 0));
  replaceChunks(
    [
      {
        id: 'chunk-puzzle-fee',
        documentId: 'puzzle-fees-2026',
        text: 'The monthly fee for Puzzle is EUR 4. Part of the fee may be waived under some circumstances.',
        title: 'Puzzle · fees',
        version: 2,
        validFrom: '2026-01-01',
        validTo: null,
        audience: 'public',
        vector,
      },
    ],
    { model: config.embeddingModel, dimensions },
  );
  const result = evaluateFees({
    userId: 'lucia',
    accounts: [feeAccount('acc-p', 'Puzzle account')],
    movements: [],
  });
  const a = result.accounts[0];
  assert.equal(a.status, 'undetermined');
  assert.equal(a.feeCents, null);
  assert.match(a.reason!, /waiver rule that cannot be parsed/);
});

test('caveats disclose the settlement assumption and the evaluated month', () => {
  seedApp();
  const result = evaluateFees({
    userId: 'lucia',
    accounts: [feeAccount('acc-a', 'Aurora account')],
    movements: [],
  });
  assert.ok(result.caveats.some((c) => /settled/i.test(c) && /settlement status/i.test(c)));
  assert.ok(result.caveats.some((c) => /2026-09/.test(c)));
});

test('the fee_status tool decides from the ledger served by the bank', async () => {
  seedApp();
  fakeBank.operations.clear();
  fakeBank.requests.length = 0;
  resetApprovalBehavior();
  fakeBank.behavior.accounts = () => ({
    status: 200,
    payload: [
      feeAccount('acc-lucia', 'Aurora account'),
      feeAccount('acc-lucia-savings', 'Personal savings'),
    ],
  });
  fakeBank.behavior.movements = () => ({
    status: 200,
    payload: [
      feeMovement('acc-lucia', 175000, 'September salary', 2),
      ...cardPurchases('acc-lucia', 4),
    ],
  });
  try {
    const { toolDefinitions, runTool } = await import('../src/agent/tools');
    const definition = toolDefinitions.find((t) => t.name === 'fee_status');
    assert.ok(definition);
    assert.deepEqual(definition.parameters, {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    });
    const result = (await runTool('fee_status', {}, {
      userId: 'lucia',
      conversationId: null,
      runId: 'run-fee',
      intentId: 'intent-fee',
    } as any)) as any;
    // The savings account has no fee policy, so the aggregate is undetermined,
    // but the Aurora account is fully decided from the ledger.
    assert.equal(result.status, 'undetermined');
    assert.ok(result.caveats.some((c: string) => /settled/i.test(c)));
    const aurora = result.accounts.find((a: any) => a.product === 'aurora');
    assert.equal(aurora.status, 'decided');
    assert.equal(aurora.feeCents, 0);
    assert.equal(aurora.policy.documentId, 'aurora-fees-2026');
    assert.ok(aurora.conditions.every((c: any) => c.met));
    const savings = result.accounts.find((a: any) => a.product === 'personal savings');
    assert.equal(savings.status, 'undetermined');
    assert.equal(savings.feeCents, null);
    // Identity comes from the session, never from tool arguments.
    assert.deepEqual([...new Set(fakeBank.requests.map((r) => r.actor))], ['lucia']);
  } finally {
    fakeBank.behavior.accounts = null;
    fakeBank.behavior.movements = null;
  }
});

test('the migration adds cancelled_at to an existing approvals table', async () => {
  // Recreate a database as it looked before the cancellation feature: an
  // approvals table without the cancelled_at column.
  closeAppDb();
  for (const suffix of ['', '-wal', '-shm'])
    fs.rmSync(path.join(temp, `app.sqlite${suffix}`), { force: true });
  const { default: Database } = await import('better-sqlite3');
  const old = new Database(path.join(temp, 'app.sqlite'));
  old.exec(
    'CREATE TABLE approvals(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,intent_id TEXT NOT NULL,payload TEXT NOT NULL,expires_at TEXT NOT NULL,consumed_at TEXT)',
  );
  old.close();
  // Opening the app must migrate the pre-existing table without throwing.
  const db = appDb();
  const columns = db.prepare('PRAGMA table_info(approvals)').all() as Array<{ name: string }>;
  assert.ok(columns.some((c) => c.name === 'cancelled_at'));
  // Reopening must not attempt a second ALTER: the guard keeps it idempotent.
  closeAppDb();
  const reopened = appDb();
  assert.ok(
    (reopened.prepare('PRAGMA table_info(approvals)').all() as Array<{ name: string }>).some(
      (c) => c.name === 'cancelled_at',
    ),
  );
});

after(() => {
  closeAppDb();
  closeBankDb();
  fs.rmSync(temp, { recursive: true, force: true });
});
