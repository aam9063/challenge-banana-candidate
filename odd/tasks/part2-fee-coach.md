# Feature: Part 2 (extension) — Fee Coach

Branch: `feature/fee-coach` (from `dev`).

## Goal

Answer *"will I be charged a fee this month?"* by crossing **the customer's real movements** with the **in-force product policy**, using **deterministic rules in code** (the LLM does not compute: it only presents). Every statement carries the document citation and version; whatever cannot be verified is declared.

## Why it is distinctive

- A generic chatbot can *explain* the policy; this one **evaluates it against the customer's ledger**.
- The decision is made by pure, testable code rather than by the model: demonstrable by reading `src/banking/feePolicy.ts`.
- It composes all of Part 1: a verified ledger (exactly-once/reconciliation), documents in force by date (not archived ones), traceable citations and honesty about what is not known.

## Verified data contract (not assumed)

| Data | Reality in the simulator |
|---|---|
Accounts | `GET /v1/accounts` → `label` ('Aurora account', 'Personal savings', …) → mappable to a product |
Movements | `GET /v1/movements` → `amountCents`, `description`, `createdAt` — **no type field and no settlement field** |
Seeded salary | `'September salary'` **+175,000 c** (€1,750) |
Purchases | 4 debits (~€10–20) `Groceries`, `Internet bill`, `Coffee shop`, `Transport` |
Fee per product | Aurora 6 · Horizon 3 · Cloud 0 · Community 2 · Family 5 (`{product}-fees-2026`, v2) |
Waiver | Aurora only (`waived` + `salary` + 3 card purchases in the same month) |
Archived documents | `archive-aurora-*` = EUR 8 → **trap**: must never be used for the current month |

## Tasks

- [x] 1. `src/banking/feePolicy.ts`: pure engine. Reads the product's **in-force** document from the index, extracts the fee and the waiver rule **from the document text** (not from a hardcoded table); evaluates the conditions against the month's movements; returns a structured result plus `caveats`.
- [x] 2. `fee_status` tool in `src/agent/tools.ts` (customer accounts + movements from the bank API) returning the structured result.
- [x] 3. Guidance in `src/agent/prompt.ts`: for fee questions use the tool and present facts + conditions + citation; never compute or estimate on its own; state the caveats.
- [x] 4. Tests (pure, no services): fee parsing and waiver detection over the 5 real documents; condition evaluation with synthetic ledgers (with/without salary, 0/1/2/3/4 purchases); product with no policy (savings) → undetermined; the archived document is never selected; tool-level against the fake bank.
- [x] 5. Live verification with the real model (Lucía Aurora + another product) plus a demo line for the video.
- [x] 6. Work-unit commit + `work-log.md` §6 + `session-03` phase 1.

## Design decisions

- **The fee comes from the document, not from the code**: if the text does not state it, the engine answers "cannot determine it" (it never invents). A test pins the 5 real values.
- **"Settled"**: the ledger does not record settlement status → posted movements are treated as settled, and this is stated explicitly in `caveats`.
- **Evaluated month**: derived from the reference date (2026-09-24) rather than the wall clock, disclosed as a caveat and listed as a limitation in the submission.
- **Product with no fee policy** (e.g. a savings account): `undetermined` result with an explanation, no invented figure.
- **Validity**: the index is queried through the same validity filter at the reference date, so archived documents are excluded by design.

## Expected result (shape)

```jsonc
{
  "status": "decided",            // or "undetermined"
  "month": "2026-09",
  "policy": { "documentId": "aurora-fees-2026", "version": 2, "validFrom": "2026-09-01", "validTo": null },
  "accounts": [
    { "accountId": "acc-lucia", "product": "aurora", "feeCents": 0,
      "conditions": [ { "name": "salary>=1200", "met": true, "evidence": "…" },
                      { "name": "settled card purchases>=3", "met": true, "evidence": "4 …" } ] }
  ],
  "caveats": ["Posted movements are treated as settled; the ledger does not record settlement status."]
}
```
