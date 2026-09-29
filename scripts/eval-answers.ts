/**
 * Answer-quality eval for Banana Bank.
 *
 * Logs in as customer `lucia`, opens a FRESH conversation per question, asks
 * eight ground-truth questions and scores each answer against criteria:
 * fact correct, forbidden fact absent, citation token present.
 *
 * The former single Aurora fee question was split into two questions with
 * separate intents, because the published product fee and the fee actually
 * decided for this customer can legitimately differ (the deterministic
 * fee_status engine may waive the published fee for this customer):
 * - "What is the published monthly fee for the Aurora account?" checks the
 *   published policy figure (EUR 6) from documentation.
 * - "Will I be charged a fee for my Aurora account this month?" checks the
 *   deterministic fee engine outcome for this customer (EUR 0: both waiver
 *   conditions met). Neither criterion was loosened.
 *
 * Usage:
 *   APP_URL=http://127.0.0.1:3000 LABEL=after REPEATS=2 OUT=submission/evidence/eval-after.json \
 *     node --import tsx scripts/eval-answers.ts
 *
 * Dependency-free (plain fetch, node:crypto not needed). Never throws on a
 * failed question: failures are recorded and the run continues. Exit code is
 * 0 as long as the summary file was written.
 */
const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:3000';
const LABEL = process.env.LABEL ?? 'unlabeled';
const REPEATS = Math.max(1, Number.parseInt(process.env.REPEATS ?? '1', 10) || 1);
const OUT =
  process.env.OUT ?? `submission/evidence/eval-${LABEL.replace(/[^a-z0-9._-]/gi, '-')}.json`;

/** Request timeout per question (the agent can take a while: tools + LLM). */
const TIMEOUT_MS = 180_000;

/** Citation token like [aurora-fees-2026 v2]. */
const CITE = /\[[A-Za-z0-9._-]+ v\d+\]/g;

/** Currency-formatted amounts: "EUR 6", "€6", "6 euros", "6.00 EUR". */
const currencyAmount = (n: number | string) =>
  new RegExp(`(?:EUR|€)\\s*${n}(?:[.,]00)?\\b|\\b${n}(?:[.,]00)?\\s*(?:EUR|euros?|€)`, 'i');

interface Question {
  question: string;
  /** Criterion: the required fact appears in the answer. */
  fact: (answer: string) => boolean;
  /** Criterion: the forbidden fact does NOT appear in the answer. */
  forbidden?: (answer: string) => boolean;
  factHint: string;
  forbiddenHint?: string;
  /** Only the three factual questions require a [docId vN] citation token. */
  requireCitation?: boolean;
}

const QUESTIONS: Question[] = [
  {
    // Published-policy intent: the product's fee as documented, answerable
    // from the in-force fee document (and only from it — the ledger cannot
    // answer a published-policy question).
    question: 'What is the published monthly fee for the Aurora account?',
    fact: (a) => currencyAmount(6).test(a),
    forbidden: (a) => currencyAmount(8).test(a),
    factHint: 'states EUR 6 as the published Aurora monthly fee',
    forbiddenHint: 'does NOT state EUR 8',
    requireCitation: true,
  },
  {
    // This-month intent: the deterministic fee engine decides what THIS
    // customer is charged this month (both waiver conditions met -> EUR 0).
    question: 'Will I be charged a fee for my Aurora account this month?',
    fact: (a) => currencyAmount(0).test(a) || /waiv(?:er|ed)/i.test(a),
    // Stating that this customer will be charged EUR 6 this month is the
    // forbidden outcome. A sentence that merely mentions the published fee
    // as context ("normally EUR 6, waived") must not fail the criterion, so
    // the check is sentence-scoped and exempts waiver/published framings.
    forbidden: (a) =>
      a
        .split(/(?<=[.!?])\s+/)
        .some(
          (s) =>
            currencyAmount(6).test(s) &&
            /charg|you (?:will )?pay|fee (?:is|of|applies)|amount (?:is|due)/i.test(s) &&
            !/waiv|no fee|not (?:be )?charg|published|normally|instead/i.test(s),
        ),
    factHint: 'states EUR 0 / that the waiver applies for this month',
    forbiddenHint: 'does NOT state that this customer will be charged EUR 6',
    requireCitation: true,
  },
  {
    question: 'What is the monthly fee of the Horizon account?',
    fact: (a) => currencyAmount(3).test(a),
    forbidden: (a) => currencyAmount(6).test(a) || currencyAmount(8).test(a),
    factHint: 'states EUR 3 as the Horizon monthly fee',
    forbiddenHint: 'does NOT state EUR 6 or EUR 8 as the Horizon fee',
    requireCitation: true,
  },
  {
    question: 'How much money do I get for referring a friend to the bank?',
    // Acknowledges the docs do not specify a referral reward.
    fact: (a) =>
      /not (?:been )?specif|no (?:specific |applicable |documented |information )|does(?: not|n't) (?:specify|state|document|include|mention)|n't have|cannot find|couldn'?t find|no reward|do not (?:specify|document|contain|have)|missing information|not covered|not defined|no amount/i.test(
        a,
      ),
    // Any concrete euro amount presented in the answer is treated as an
    // invented reward (the docs specify none).
    forbidden: (a) => /(?:EUR|€)\s*\d|\d+(?:[.,]\d+)?\s*(?:EUR|euros?|€)/i.test(a),
    factHint: 'acknowledges the documentation does not specify a referral reward',
    forbiddenHint: 'does NOT state a specific reward amount',
  },
  {
    question: 'What is the maximum amount I can transfer in one operation?',
    fact: (a) => /100[,.]?\u00a0?000|100[,.\s]000|100000|100,000/i.test(a),
    factHint: 'states 100,000 (EUR 100,000) per operation',
    requireCitation: true,
  },
  {
    question: 'What is the monthly fee of the Cloud account?',
    fact: (a) => currencyAmount(0).test(a),
    // Any other published fee presented as the Cloud fee is wrong.
    forbidden: (a) => currencyAmount(2).test(a) || currencyAmount(5).test(a) || currencyAmount(6).test(a),
    factHint: 'states EUR 0 as the Cloud monthly fee',
    forbiddenHint: 'does NOT state EUR 2, EUR 5 or EUR 6 as the Cloud fee',
    requireCitation: true,
  },
  {
    question: 'What is the monthly fee of the Community account?',
    fact: (a) => currencyAmount(2).test(a),
    forbidden: (a) => currencyAmount(0).test(a) || currencyAmount(5).test(a) || currencyAmount(6).test(a),
    factHint: 'states EUR 2 as the Community monthly fee',
    forbiddenHint: 'does NOT state EUR 0, EUR 5 or EUR 6 as the Community fee',
    requireCitation: true,
  },
  {
    question: 'What is the monthly fee of the Family account?',
    fact: (a) => currencyAmount(5).test(a),
    forbidden: (a) => currencyAmount(0).test(a) || currencyAmount(2).test(a) || currencyAmount(6).test(a),
    factHint: 'states EUR 5 as the Family monthly fee',
    forbiddenHint: 'does NOT state EUR 0, EUR 2 or EUR 6 as the Family fee',
    requireCitation: true,
  },
];

async function api(
  path: string,
  init: RequestInit & { cookie?: string } = {},
): Promise<{ status: number; body: any; setCookie?: string | null }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (init.cookie) headers['cookie'] = init.cookie;
  const res = await fetch(`${APP_URL}${path}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body, setCookie: res.headers.get('set-cookie') };
}

async function runOnce(q: Question, cookie: string): Promise<any> {
  const record: any = {};
  try {
    // Fresh conversation per question: no history contamination.
    const conv = await api('/api/conversations', { method: 'POST', cookie });
    if (conv.status !== 201 || !conv.body?.id) {
      throw new Error(`conversation create failed: HTTP ${conv.status}`);
    }
    const asked = await api(`/api/conversations/${conv.body.id}/messages`, {
      method: 'POST',
      cookie,
      body: JSON.stringify({ content: q.question }),
    });
    if (asked.status !== 200) {
      throw new Error(`message failed: HTTP ${asked.status} ${JSON.stringify(asked.body)}`);
    }
    const answer = String(asked.body?.answer ?? '');
    // Normalize typographic apostrophes/quotes so word matching (couldn't)
    // is deterministic regardless of the model's punctuation.
    const normalized = answer.replace(/[\u2018\u2019\u02bc]/g, "'");
    const citations = answer.match(CITE) ?? [];
    const factCorrect = q.fact(normalized);
    const forbiddenAbsent = q.forbidden ? !q.forbidden(normalized) : true;
    record.answer = answer;
    record.citations = citations;
    record.criteria = {
      factCorrect,
      forbiddenAbsent,
      cited: citations.length > 0,
    };
    record.pass =
      factCorrect && forbiddenAbsent && (!q.requireCitation || citations.length > 0);
  } catch (e) {
    record.error = e instanceof Error ? e.message : String(e);
    record.criteria = { factCorrect: false, forbiddenAbsent: false, cited: false };
    record.pass = false;
  }
  return record;
}

async function main() {
  // Login as lucia; keep the session cookie for all later calls.
  const login = await api('/api/session', {
    method: 'POST',
    body: JSON.stringify({ userId: 'lucia' }),
  });
  if (login.status !== 200) {
    console.error(`login failed: HTTP ${login.status}`, login.body);
  }
  const cookie = (login.setCookie ?? '').split(';')[0];

  const aggregated = QUESTIONS.map((q) => ({
    question: q.question,
    criteria: { factHint: q.factHint, forbiddenHint: q.forbiddenHint },
    runs: [] as any[],
    passCount: 0,
    citedCount: 0,
    repeats: REPEATS,
  }));

  for (let r = 0; r < REPEATS; r++) {
    if (REPEATS > 1) console.log(`\n=== repetition ${r + 1}/${REPEATS} ===`);
    for (let i = 0; i < QUESTIONS.length; i++) {
      const q = QUESTIONS[i];
      const record = await runOnce(q, cookie);
      const agg = aggregated[i];
      agg.runs.push(record);
      if (record.pass) agg.passCount++;
      if (record.criteria?.cited) agg.citedCount++;
      const flag = record.pass ? 'PASS' : 'FAIL';
      console.log(`[${flag}] ${q.question}`);
      console.log(`  citations: ${JSON.stringify(record.citations ?? [])}`);
      console.log(`  criteria: ${JSON.stringify(record.criteria)}`);
      if (record.answer) console.log(`  answer: ${record.answer.slice(0, 400)}`);
      if (record.error) console.log(`  error: ${record.error}`);
    }
  }

  // Overall totals across every turn (question x repetition).
  const totalTurns = REPEATS * QUESTIONS.length;
  const passed = aggregated.reduce((n, a) => n + a.passCount, 0);
  const cited = aggregated.reduce((n, a) => n + a.citedCount, 0);

  const summary = {
    label: LABEL,
    appUrl: APP_URL,
    repeats: REPEATS,
    questions: aggregated,
    // Legacy single-run fields: with REPEATS=1 these keep their original
    // meaning (total = question count). With REPEATS>1 they become the
    // turn-level totals and `totalTurns`/`repeats` carry the repetition info.
    total: QUESTIONS.length,
    totalTurns,
    passed,
    cited,
    perQuestion: aggregated.map((a) => ({
      question: a.question,
      passCount: a.passCount,
      citedCount: a.citedCount,
      repeats: a.repeats,
    })),
  };
  const { mkdir, writeFile } = await import('node:fs/promises');
  await mkdir(OUT.replace(/[/\\][^/\\]+$/, '') || '.', { recursive: true });
  await writeFile(OUT, JSON.stringify(summary, null, 2) + '\n');
  console.log(
    `\nSummary (${LABEL}): repeats ${REPEATS}, turns ${totalTurns}, passed ${passed}/${totalTurns}, cited ${cited}/${totalTurns}`,
  );
  for (const a of aggregated) {
    console.log(`  [${a.passCount}/${a.repeats}] (cited ${a.citedCount}) ${a.question}`);
  }
  console.log(`Wrote ${OUT}`);
}

main().catch((e) => {
  // Only a fatal setup error (login/network) lands here; still try to exit 0
  // if a summary was not required, but report loudly.
  console.error('fatal:', e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
