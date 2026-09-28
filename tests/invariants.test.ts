import test, { after } from 'node:test';
import assert from 'node:assert/strict';
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
const { chunkDocument } = await import('../src/ingestion/chunker');
const { allChunks, replaceChunks } = await import('../src/retrieval/store');
const { searchDocuments } = await import('../src/retrieval/search');
const { embeddingKey, vectorBuffer, dimensions } = await import('../src/retrieval/embeddings');
import type { Chunk, DocumentRecord } from '../src/types';
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
type FakeBankResponse = { status: number; payload?: unknown };
/**
 * Minimal in-process bank double implementing the documented contract so the
 * application-level transfer path can be tested without live services. The
 * idempotency key is actor+reference; behaviors decide when effects commit.
 */
function startFakeBank() {
  const requests: Array<{ method: string; path: string; body: any }> = [];
  const operations = new Map<string, any>();
  const behavior = {
    transfer: null as
      | null
      | ((
          body: any,
          commit: () => void,
          replay: boolean,
        ) => FakeBankResponse),
    lookup: null as null | ((reference: string) => FakeBankResponse),
  };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const requestPath = req.url ?? '';
      requests.push({
        method: req.method ?? '',
        path: requestPath,
        body: raw ? JSON.parse(raw) : undefined,
      });
      const respond = ({ status, payload }: FakeBankResponse) => {
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
      if (req.method === 'GET' && requestPath.startsWith('/v1/accounts'))
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
  const posts = fakeBank.requests.filter(
    (r) => r.method === 'POST' && r.path === '/v1/transfers',
  );
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
    () =>
      transferMoney({ ...transferContext(intentId), approvalId: proposal.approvalId }, input),
    (e: unknown) =>
      e instanceof HttpError && e.status === 409 && /does not match/i.test(e.message),
  );
  assert.equal(transferPosts(), 0);
});

after(() => {
  closeAppDb();
  closeBankDb();
  fs.rmSync(temp, { recursive: true, force: true });
});
