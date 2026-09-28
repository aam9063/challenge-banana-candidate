/**
 * Repro: double debit on transfer retry (Part 1, Bug 1).
 *
 * Run with services up:  npm run dev   (in another terminal or background)
 * Then:                  node --import tsx scripts/repro-double-debit.ts
 *
 * Uses the `lost-response` bank profile: the FIRST new operation commits at the
 * bank and then the response is lost (504) — exactly the window where the
 * reference-per-attempt bug and the missing intent-status check combine into a
 * double debit. No admin endpoints are used to complete or inspect operations;
 * they are only used to configure the documented failure profile.
 */
const BASE = process.env.APP_URL ?? 'http://127.0.0.1:3000';

// Mark this file as a module so its top-level await typechecks under tsc.
export {};
const BANK_ADMIN = process.env.BANK_ADMIN_SECRET ?? 'banana-local-admin';
const BANK_URL = process.env.BANK_URL ?? 'http://127.0.0.1:4001';
const AMOUNT = 100; // 1.00 EUR
const INTENT_ID = `repro-double-debit-${Date.now()}`;

interface Account {
  id: string;
  label: string;
  balanceCents: number;
}

async function login(userId: string): Promise<string> {
  const res = await fetch(`${BASE}/api/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  if (!res.ok) throw new Error(`session ${userId}: HTTP ${res.status}`);
  return res.headers.get('set-cookie')!.split(';')[0];
}

async function balance(cookie: string, accountId: string): Promise<number> {
  const res = await fetch(`${BASE}/api/dashboard`, { headers: { cookie } });
  const data = (await res.json()) as { accounts: Account[] };
  return data.accounts.find((a) => a.id === accountId)!.balanceCents;
}

async function brunoAccountId(cookie: string): Promise<string> {
  const res = await fetch(`${BASE}/api/dashboard`, { headers: { cookie } });
  const data = (await res.json()) as { contacts: Array<{ id: string; userId: string }> };
  return data.contacts.find((c) => c.userId === 'bruno')!.id;
}

async function setScenario(profile: string): Promise<void> {
  const res = await fetch(`${BANK_URL}/admin/scenario`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', authorization: `Bearer ${BANK_ADMIN}` },
    body: JSON.stringify({ profile }),
  });
  if (!res.ok) throw new Error(`scenario: HTTP ${res.status} — is the bank running?`);
}

async function transfer(cookie: string, from: string, to: string): Promise<unknown> {
  const res = await fetch(`${BASE}/api/actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({
      name: 'transfer_money',
      intentId: INTENT_ID, // SAME intent = same customer intention (retry)
      arguments: { fromAccountId: from, toAccountId: to, amountCents: AMOUNT, concept: 'Repro retry' },
    }),
  });
  return res.json();
}

const euro = (cents: number) => `€${(cents / 100).toFixed(2)}`;

const cookie = await login('lucia');
const from = 'acc-lucia';
const to = await brunoAccountId(cookie);
const b0 = await balance(cookie, from);

console.log(`intent: ${INTENT_ID}`);
console.log(`transfer: ${from} -> ${to} amount ${euro(AMOUNT)}`);
console.log(`balance before:              ${euro(b0)}`);

await setScenario('lost-response');
const first = (await transfer(cookie, from, to)) as { status: string; error?: string };
const b1 = await balance(cookie, from);
console.log(`\n[1st attempt, same intentId] app status: ${first.status}${first.error ? ` (${first.error})` : ''}`);
console.log(`balance after 1st attempt:   ${euro(b1)}  (delta -${euro(b0 - b1)})`);

const retry = (await transfer(cookie, from, to)) as { status: string; error?: string };
const b2 = await balance(cookie, from);
console.log(`\n[retry, same intentId]       app status: ${retry.status}${retry.error ? ` (${retry.error})` : ''}`);
console.log(`balance after retry:         ${euro(b2)}  (delta -${euro(b0 - b2)})`);

console.log('\n=== VERDICT ===');
if (b0 - b2 > AMOUNT) {
  console.log(
    `DOUBLE DEBIT CONFIRMED: one ${euro(AMOUNT)} intention debited ${euro(b0 - b2)}.`,
  );
  console.log(`First attempt reported "${first.status}" to the customer while the bank had committed it.`);
} else if (b0 - b2 === AMOUNT) {
  console.log('No double debit observed (fixed?).');
} else {
  console.log('Unexpected balance delta — inspect manually.');
}
