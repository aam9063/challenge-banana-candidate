import { allChunks } from '../retrieval/store';
import { referenceDate } from '../config';
import type { Account, BankMovement, Chunk } from '../types';

// Deterministic fee coach: the fee decision is made here, in pure code, from
// the customer's real ledger crossed with the in-force policy document text.
// The LLM never computes or estimates a fee; it only presents this result.

export type FeeCondition = { name: string; met: boolean; evidence: string };
export type FeePolicyRef = {
  documentId: string;
  version: number | null;
  validFrom: string | null;
  validTo: string | null;
};
export type AccountFeeStatus = {
  accountId: string;
  label: string;
  product: string;
  status: 'decided' | 'undetermined';
  /** Fee that applies this month; null when it cannot be determined. */
  feeCents: number | null;
  reason: string | null;
  conditions: FeeCondition[];
  policy: FeePolicyRef | null;
};
export type FeeStatusResult = {
  status: 'decided' | 'undetermined';
  month: string;
  policy: FeePolicyRef | null;
  accounts: AccountFeeStatus[];
  caveats: string[];
};

const SETTLEMENT_CAVEAT =
  'Posted movements are treated as settled: the ledger does not record a settlement status, so a posted card purchase counts as settled.';

export function productFromLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/\s+account\s*$/, '')
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Parses an EUR figure such as "6", "1,200" or "1 200.50" into integer cents. */
function parseEurToCents(raw: string): number {
  const value = Number(raw.replace(/[\s,]/g, ''));
  if (!Number.isFinite(value)) return NaN;
  return Math.round(value * 100);
}

function formatEur(cents: number): string {
  return `EUR ${(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

type PolicyDocument = {
  documentId: string;
  text: string;
  version: number | null;
  validFrom: string | null;
  validTo: string | null;
};

// Same validity semantics as src/retrieval/search.ts: uniform date-only
// values (YYYY-MM-DD) compared lexicographically; null bounds are open-ended.
function isInForce(chunk: Chunk, at: string): boolean {
  return (
    (chunk.validFrom === null || chunk.validFrom <= at) &&
    (chunk.validTo === null || chunk.validTo >= at)
  );
}

/**
 * Finds the fee policy documents for a product among the public documents in
 * force at the reference date. The primary route is the corpus convention
 * `<product>-fees-*`; a text-based fallback keeps this working if the naming
 * convention changes. Archived documents (`archive-*`) are never candidates.
 */
function findFeeDocuments(product: string, at: string): PolicyDocument[] {
  const byDocument = new Map<string, { texts: string[]; meta: Chunk }>();
  for (const chunk of allChunks()) {
    if (chunk.audience !== 'public' || !isInForce(chunk, at)) continue;
    const entry = byDocument.get(chunk.documentId);
    if (entry) entry.texts.push(chunk.text);
    else byDocument.set(chunk.documentId, { texts: [chunk.text], meta: chunk });
  }
  const candidates = [...byDocument.entries()].filter(([id]) => !id.startsWith('archive-'));
  const feePattern = new RegExp(`^${escapeRegExp(product)}-fees-`, 'i');
  let matches = candidates.filter(([id]) => feePattern.test(id));
  if (!matches.length) {
    // Fallback: a document whose text states a monthly fee for this product.
    const namePattern = new RegExp(`\\b${escapeRegExp(product)}\\b`, 'i');
    matches = candidates.filter(([, { texts }]) => {
      const text = texts.join(' ');
      return namePattern.test(text) && /monthly fee/i.test(text) && /EUR/i.test(text);
    });
  }
  return matches
    .map(([documentId, { texts, meta }]) => ({
      documentId,
      text: texts.join(' '),
      version: meta.version,
      validFrom: meta.validFrom,
      validTo: meta.validTo,
    }))
    .sort((a, b) => (b.version ?? -1) - (a.version ?? -1));
}

// Covers both corpus phrasings: "The Aurora account monthly fee is EUR 6."
// and "The monthly fee for Horizon is EUR 3." (the "for <product>" part and
// "of" are optional).
const FEE_PATTERN =
  /monthly fee(?:\s+for\s+[A-Za-z]+(?:\s+account)?)?(?:\s+of)?\s+is\s+EUR\s*([\d][\d\s.,]*)/i;

type WaiverRule =
  | { kind: 'none' }
  | { kind: 'parsed'; salaryThresholdCents: number; purchaseCount: number }
  | { kind: 'unparseable' };

const WORD_NUMBERS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

function parseWaiver(text: string): WaiverRule {
  if (!/waiv/i.test(text)) return { kind: 'none' };
  // "This product does not use the Aurora account salary waiver."
  if (/\bdoes not\s+(?:use|apply|offer|have|charge)\b[^.]*waiver/i.test(text))
    return { kind: 'none' };
  if (!/salary/i.test(text)) return { kind: 'unparseable' };
  const salaryMatch = /salary[^.]{0,60}?\bat least\s+EUR\s*([\d][\d\s.,]*)/i.exec(text);
  const purchaseMatch =
    /(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+settled\s+card\s+purchases/i.exec(
      text,
    );
  if (!salaryMatch || !purchaseMatch) return { kind: 'unparseable' };
  const salaryThresholdCents = parseEurToCents(salaryMatch[1]);
  const purchaseCount = /^\d+$/.test(purchaseMatch[1])
    ? Number(purchaseMatch[1])
    : WORD_NUMBERS[purchaseMatch[1].toLowerCase()];
  if (!Number.isFinite(salaryThresholdCents) || !purchaseCount) return { kind: 'unparseable' };
  return { kind: 'parsed', salaryThresholdCents, purchaseCount };
}

const TRANSFER_LIKE = /transfer|opening balance/i;

function evaluateConditions(
  rule: Extract<WaiverRule, { kind: 'parsed' }>,
  movements: BankMovement[],
  month: string,
): FeeCondition[] {
  const inMonth = movements.filter((m) => m.createdAt.slice(0, 7) === month);
  const salaryMovements = inMonth.filter(
    (m) => m.amountCents > 0 && /salary/i.test(m.description),
  );
  const bestSalaryMovement =
    salaryMovements.reduce<BankMovement | null>(
      (max, m) => (max === null || m.amountCents > max.amountCents ? m : max),
      null,
    );
  const salaryEvidence =
    bestSalaryMovement === null
      ? `No salary payment found among the movements for ${month}.`
      : bestSalaryMovement.amountCents >= rule.salaryThresholdCents
        ? `Salary payment '${bestSalaryMovement.description}' of ${formatEur(bestSalaryMovement.amountCents)} meets the ${formatEur(rule.salaryThresholdCents)} minimum.`
        : `Largest salary payment '${bestSalaryMovement.description}' of ${formatEur(bestSalaryMovement.amountCents)} is below the ${formatEur(rule.salaryThresholdCents)} minimum.`;
  // The ledger has no settlement field: posted movements are treated as
  // settled (disclosed in the result caveats).
  const purchases = inMonth.filter(
    (m) => m.amountCents < 0 && !TRANSFER_LIKE.test(m.description),
  );
  const excluded = inMonth.filter(
    (m) => m.amountCents < 0 && TRANSFER_LIKE.test(m.description),
  ).length;
  const purchaseList =
    purchases
      .map((m) => `${m.description} ${formatEur(m.amountCents)}`)
      .slice(0, 6)
      .join(', ') + (purchases.length > 6 ? ', …' : '');
  const cardEvidence =
    `${purchases.length} card-like purchase${purchases.length === 1 ? '' : 's'} in ${month}` +
    (purchases.length ? `: ${purchaseList}` : '') +
    (excluded ? `; ${excluded} transfer-like movement${excluded === 1 ? '' : 's'} excluded` : '');
  return [
    {
      name: `salary>=${formatEur(rule.salaryThresholdCents)}`,
      met: bestSalaryMovement !== null && bestSalaryMovement.amountCents >= rule.salaryThresholdCents,
      evidence: salaryEvidence,
    },
    {
      name: `settled card purchases>=${rule.purchaseCount}`,
      met: purchases.length >= rule.purchaseCount,
      evidence: cardEvidence,
    },
  ];
}

function evaluateAccount(
  account: Account,
  movements: BankMovement[],
  at: string,
  month: string,
  caveats: string[],
): AccountFeeStatus {
  const base = {
    accountId: account.id,
    label: account.label,
    product: productFromLabel(account.label),
  };
  const productDocuments = findFeeDocuments(base.product, at);
  const document = productDocuments[0];
  if (!document) {
    const reason = `No in-force fee policy document was found for product '${base.product}' (account label '${account.label}').`;
    caveats.push(`${account.label}: ${reason}`);
    return { ...base, status: 'undetermined', feeCents: null, reason, conditions: [], policy: null };
  }
  const policy: FeePolicyRef = {
    documentId: document.documentId,
    version: document.version,
    validFrom: document.validFrom,
    validTo: document.validTo,
  };
  const feeMatch = FEE_PATTERN.exec(document.text);
  if (!feeMatch) {
    const reason = `The in-force fee document ${document.documentId} does not state a monthly fee.`;
    caveats.push(`${account.label}: ${reason}`);
    return { ...base, status: 'undetermined', feeCents: null, reason, conditions: [], policy };
  }
  const waiver = parseWaiver(document.text);
  if (waiver.kind === 'unparseable') {
    const reason = `The in-force fee document ${document.documentId} mentions a waiver rule that cannot be parsed deterministically; the fee is not guessed.`;
    caveats.push(`${account.label}: ${reason}`);
    return { ...base, status: 'undetermined', feeCents: null, reason, conditions: [], policy };
  }
  const documentedFeeCents = parseEurToCents(feeMatch[1]);
  if (!Number.isFinite(documentedFeeCents)) {
    const reason = `The monthly fee stated in ${document.documentId} could not be parsed as an EUR amount.`;
    caveats.push(`${account.label}: ${reason}`);
    return { ...base, status: 'undetermined', feeCents: null, reason, conditions: [], policy };
  }
  if (waiver.kind === 'none') {
    caveats.push(
      `${account.label}: the in-force document ${document.documentId} states a flat monthly fee with no waiver conditions.`,
    );
    return {
      ...base,
      status: 'decided',
      feeCents: documentedFeeCents,
      reason: null,
      conditions: [],
      policy,
    };
  }
  const accountMovements = movements.filter((m) => m.accountId === account.id);
  if (!accountMovements.some((m) => m.createdAt.slice(0, 7) === month)) {
    caveats.push(
      `${account.label}: no movements were found for ${month}; the conditions were evaluated against an empty month.`,
    );
  }
  const conditions = evaluateConditions(waiver, accountMovements, month);
  const waived = conditions.every((c) => c.met);
  return {
    ...base,
    status: 'decided',
    feeCents: waived ? 0 : documentedFeeCents,
    reason: null,
    conditions,
    policy,
  };
}

export function evaluateFees(
  input: { userId: string; accounts: Account[]; movements: BankMovement[] },
  options: { referenceDate?: string } = {},
): FeeStatusResult {
  const at = options.referenceDate ?? referenceDate;
  const month = at.slice(0, 7);
  const caveats = [
    SETTLEMENT_CAVEAT,
    `Conditions are evaluated against movements posted in ${month} (the UTC calendar month of the reference date ${at}); postings near a month boundary may fall in the adjacent month.`,
  ];
  const accounts = input.accounts.map((account) =>
    evaluateAccount(account, input.movements, at, month, caveats),
  );
  return {
    status: accounts.every((a) => a.status === 'decided') ? 'decided' : 'undetermined',
    month,
    policy: accounts.find((a) => a.policy)?.policy ?? null,
    accounts,
    caveats,
  };
}
