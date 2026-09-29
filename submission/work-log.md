# Banana Bank — Work Log (video material)

> **What this file is**: the chronological engineering record of the project. Every unit of work is logged as *problem → root cause (file) → reproduction → fix (commit) → verification with numbers*, plus the decisions and the declared limits.
> **What it is for**: (1) evidence for the evaluation — every claim has its reproduction; (2) video material — the recording script is in `submission/VIDEO-SCRIPT.md`.
> **Related documents**: `submission/EXPLANATION.md` (submission explanation), `submission/README.md` (inventory), `submission/ai-sessions/` (original AI sessions), `submission/evidence/` (raw measurement results).

## Index

0. [Contract → bug → fix → evidence map](#0-contract--bug--fix--evidence-map)
0b. [Starter evidence: seeded cases](#0b-starter-evidence-seeded-cases)
0c. [Before/after measurement (answer eval)](#0c-beforeafter-measurement-answer-eval)
1. [Setup and installation diagnosis](#1-setup-and-installation-diagnosis)
2. [Bug 1: Double debit on transfer retries](#2-bug-1-double-debit-on-transfer-retries)
3. [Bug 2: Stale documentation in assistant answers](#3-bug-2-stale-documentation-in-assistant-answers)
4. [Part 2: Trust Layer](#4-part-2--trust-layer-distinctive-feature)
5. [Final state: done / verified / pending](#final-state-done--verified--pending)
6. [Part 2 (extension): Fee Coach](#6-part-2-extension--fee-coach)

---

## 0. Contract → bug → fix → evidence map

The business clauses from `docs/contracts.md` and the corresponding defect in the starter. Each one with reproduction, fix and verification.

| Clause from `contracts.md` | Bug found | Reproduction / evidence | Fix | Verification |
|---|---|---|---|---|
| *"An operation intent represents a customer intention. Retrying that intent must not multiply its effects."* | New reference per attempt → money was moved **3 times** | `scripts/repro-double-debit.ts` (profile `lost-response`): a €1.00 intention → **€3.00** debited | `8056774`: `stableReference()` per intent + status gates + reconciliation | Repro printed: exact delta **−€1.00**, retry without side effects · 4 tests |
| *"A transport error or timeout does not prove that the bank rejected the operation. Customer-facing status should match verified facts."* | A 504 was marked `failed` even though the bank may have committed | Same repro + profile `slow-response`/`lost-response`; `client.ts` turned every timeout into 504 without verifying | `8056774`: `reconcileOutcome()` (found→completed · 404→verified failed · query fails→non-terminal `processing` with reference) | 3 tests (recovered via reconciliation; unverifiable never `failed`) |
| *"A sensitive operation must present its amount, source, and destination for explicit review before execution. An informational conversation alone does not authorize payment."* | `authorizeTransfer` always returned `null`: the approvals flow was dead code and the agent transferred straight from the chat | Seeded case **Elena** (`fixtures/conversations.json`): *"Before deciding whether to send EUR 25 to Hugo…"* → **"Transfer completed."** | `1b1099a`: explicit proposal (10 min) + atomic consumption + 409/410 checks; `fcd0405`: real cancellation; `221ecf7`: the agent must create the proposal with the tool; `b6b953e`: one proposal per conversation | 10 tests (proposal without debit, double confirm 409, expired 410, altered payload 409, supersede, reuse) + live E2E |
| *"Assistant information should rely on applicable documentation and make its evidence traceable. Missing evidence should be acknowledged with a useful next step. Documents can contain historical versions."* | Prompt that invited making things up (`concrete estimate`, `references are not required`) + metadata only in the first chunk + no in-force filter | Seeded cases **Inés** (*"It is common to receive EUR 30 for a referral"*) and **Carla** (correct fee but **no citation**); corpus with `archive-aurora-*` (EUR 8) competing with the in-force document (EUR 6) | `38fc5ed`: metadata on every chunk + in-force filter (2026-09-24) + re-ingestion; `53d3333`: mandatory citations `[docId vN]`, estimating forbidden, no evidence → admit it + next step | 4 tests for currency/citation + live search without `archive-*` + live questions citing `[aurora-fees-2026 v2]` |
| *"Operators need to understand the conversation, relevant steps, and effects. Historical evidence that was never recorded must not be invented."* | `caseDetail` with hardcoded `history/events/intents/bank`; `recordEvent` discarded args/outputs; cases could not be closed | Code + live verification: the operator view showed nothing of what had happened | `691c5b1`: full telemetry, populated case detail (incl. `GET /v1/operator/customer`), honest `gaps`, case closing; `c730b02`/`959c4c5`: confirmation receipt and cancellation record in the thread | 4 tests + E2E with a real case: 8 events with `arguments/output/durationMs`, operation with reference, closing and 409 on repeat |
| *"Only an account holder may initiate a transfer from that account. Operators cannot transfer customer money."* | (No defect found) the ownership check existed and the role was validated | Review of `authorization.ts` / `tools.ts` | No change | Existing role tests |
| *"Amounts are positive integer euro cents, without overdrafts. Maximum per operation: 10,000,000 cents."* | (No defect found) zod validation active | Review of `transferSchema` | No change | Existing tests |

**Reading for the evaluation**: the five material defects of the starter map to explicit contract clauses; two clauses (ownership/roles and amount limits) were already satisfied and were verified in order to rule them out.

---

## 0b. Starter evidence: seeded cases

`fixtures/conversations.json` contains 47 narrative conversations that **demonstrate the bugs inside the starter itself** — ideal evidence for the video (we did not fabricate the "before"; it ships with the project):

| Customer | Conversation | Seeded content | Clause violated |
|---|---|---|---|
| **Elena** | *Payment planning* | *"Before deciding whether to send EUR 25 to Hugo, what would I need to review?"* → **"Transfer completed."** | Explicit confirmation: an informational question "executed" a payment |
| **Diego** | *Transfer enquiry* | *"I want to send EUR 200 to Inés"* → *"The operation could not be completed."* | Unverified status / no evidence |
| **Inés** | *Rewards question* | *"It is common to receive EUR 30 for a referral."* | Hallucination: the documents do **not** specify referrals (`context-guide-*`) |
| **Carla** | *Account information* | *"The Aurora monthly fee is EUR 6."* (correct but **without citation**) | Traceable evidence missing |
| **Lucía** | *Dinner payment* | *"I could not complete the transfer. You can try again."* | Unverified status |

With the fixes, these same cases change behavior: Elena gets a proposal to confirm (not a fake "completed"), Inés is told there is no applicable documentation and is offered a next step, Carla gets the fee **with citation and version**, and Diego/Lucía get a status verified against the bank.

### Live verification of the seeded cases (after)

Asked exactly as seeded, with the fixed code:

**Elena** — *"Before deciding whether to send EUR 25 to Hugo, what would I need to review?"*

> Review the source account and available balance, confirm that Hugo is the intended recipient, and check the transfer details before deciding. **I haven't sent anything.**

→ Zero proposals created: an informational question no longer "executes" anything, and the assistant explicitly states it has not sent anything (before, it answered "Transfer completed.").

**Inés** — *"How much money do I get for referring a friend to the bank?"*

> I couldn't find applicable documentation stating how much a referral reward pays. You can check the Documents section in the app, or I can open a support case to ask about the current referral offer.

→ It admits the lack of evidence and offers two concrete next steps (documentation or a support case); before, it made up "EUR 30".

---

## 0c. Before/after measurement (answer eval)

Instrument: `scripts/eval-answers.ts` — 7 questions with ground truth from the corpus, each in a fresh conversation, scoring three criteria: **correct fact**, **forbidden fact absent** (the archive trap) and **citation `[docId vN]`**. `REPEATS=2` → 14 turns per side. Raw evidence: `submission/evidence/eval-before-r2.json` and `eval-after-r2.json`.

- **BEFORE**: base commit `db0bdf5`, its own server on ports 3010/4011 (disposable worktree, already removed).
- **AFTER**: the branch with the fixes, server on 3000.

| # | Question | Truth | Trap | BEFORE | AFTER |
|---|---|---|---|---|---|
| 1 | Aurora fee | EUR 6 | EUR 8 (archived) | 0/2 · no citation | **2/2 · cited** (`aurora-fees-2026 v2`) |
| 2 | Horizon fee | EUR 3 | 6/8 from Aurora | 0/2 · no citation | **2/2 · cited** (`horizon-fees-2026 v2`) |
| 3 | Referral reward | not documented | EUR 30 invented | 1/2 · no citation | **2/2** (citation not required) |
| 4 | Limit per transfer | EUR 100.000 | — | 0/2 · no citation | **2/2 · cited** (`aurora-operations-2026 v2`) |
| 5 | Cloud fee | EUR 0 | 2/5/6 | 0/2 · no citation | **2/2 · cited** |
| 6 | Community fee | EUR 2 | 0/5/6 | 0/2 · no citation | **2/2 · cited** |
| 7 | Family fee | EUR 5 | 0/2/6 | 0/2 · no citation | **2/2 · cited** |
| | **Total** | | | **1/14 pass · 0/14 cite** | **14/14 pass · 12/14 cite (12/12 of the required ones)** |

### Honest reading of the result

- **The measured delta is traceability, not factual accuracy.** The base code answered all 7 facts correctly in both repetitions; what changes with the fix is the **grounding**: 0/12 turns cited before → 12/12 cite with the correct `docId` and version after. That is exactly the clause *"make its evidence traceable"*.
- **The base's 1/14 is not entirely a failure of the base agent**: 13 turns fail due to the citation requirement (and 1 of them due to paraphrase: the base said *"couldn't verify a referral reward"* and the regex only matched *"couldn't find"*). It is recorded to avoid over-interpreting the number.
- **No invention in any of the 28 answers**: neither EUR 8 as the in-force fee, nor a referral reward, nor cross-product fees.
- **Instrument limits (declared)**: it scores by presence/absence of figures, so an answer that *compares* products (e.g. "Horizon costs EUR 3, not EUR 6 like Aurora") would count the 6 as forbidden and produce a false negative. It did not happen in any of the 28 answers, and the bias — if any — is **against** our measurement, never in its favor.
- **Known limit of the fix**: genuinely historical questions do not retrieve the archived value (expired documents are outside the search that feeds answers; they remain visible in the library). Verified live: *"What was the Aurora account monthly fee before September 2026?"* → the assistant admits it has no applicable documentation, cites the in-force notice `[notice-aurora v2]` and offers to consult the archive via support — **it does not invent the EUR 8**.

---

## 1. Setup and installation diagnosis

**Date**: 28-09-2026

**Problem**: `npm ci` failed on Windows (Node 24.18.0).

**Diagnosis** (reproducible commands):
1. `npm ci` → `node-gyp ERR! find VS ... missing any VC++ toolset` — the C++ compiler was not installed.
2. Manual `prebuild-install` → **404**: there is no prebuild of `better-sqlite3@13.0.3` for Node 24 (ABI v137) on win32-x64, so npm always fell back to compiling with node-gyp.
3. `npm install --ignore-scripts` → the other 32 packages installed without trouble; the only blocker was the native module.

**Fix**: installing the *"Desktop development with C++"* workload (`Microsoft.VisualStudio.Workload.NativeDesktop`) on top of the existing VS 2022 Community. Afterwards: `npm ci` → 0 errors, 0 vulnerabilities.

**Second problem**: `npm run doctor` failed with `connection_or_configuration_error` even though the key was in `.env`.
**Root cause**: `scripts/setup.ts` creates `.env.local` with an **empty** `OPENAI_API_KEY=`, and `src/config.ts:3-4` loads `.env.local` before `.env`. dotenv does not override already-defined variables → the empty value was masking the real key.
**Fix**: removing the empty line from `.env.local`. Doctor afterwards: green.

**Code fix (not just the local environment)** — branch `fix/env-precedence`, commit `c16bca1`: `scripts/setup.ts` now writes `.env.local` with the `OPENAI_API_KEY` line **commented out**, so the key can come from `.env.local`, from `.env` or from the environment without an empty value masking it; and `README.md` documents the precedence and the trap. Without this, anyone cloning the submission would hit the same confusing error on their first `npm run doctor`.

Verification: `.env.local` was deleted, `npm run setup` was run and the generated file contains `# OPENAI_API_KEY=`; the original was restored byte-identical (checked with `diff`).

**Final verification** (README walkthrough, everything via API and UI):
- `npm run doctor` → `gpt-6-luna` responds, embeddings 1536 dims ✅
- Lucía sees 2 accounts: Aurora €4.007,50 + Savings €1.000,00 ✅
- Marta (operator) sees 17 support cases ✅
- Chat: *"What accounts do I have?"* → correct answer with both accounts and exact balances ✅

---

## 2. Bug 1: Double debit on transfer retries

**Date**: 28-09-2026 · **Severity**: critical (money) · **Status**: IN PROGRESS

### The problem

The contracts (`docs/contracts.md`) require: *"Retrying that intent must not multiply its effects"* and *"A transport error or timeout does not prove that the bank rejected the operation"*.

### Root cause (code reading)

- `src/banking/dispatch.ts:6-8`: every send attempt generates a **new reference** (`randomUUID()`), nullifying the bank's idempotency (the key is `actor + reference`). It also overwrites `intents.bank_reference`, destroying the original reference.
- `src/banking/actions.ts:22-45`: when re-sending the same `intentId`, only user and payload are validated — **never the intent's `status`**. A `completed` or `failed` intent gets dispatched again.
- `src/banking/client.ts:24-25`: a timeout becomes `BankError(504)` with no way to distinguish "the bank rejected it" from "the bank executed it and we lost the response".

### Reproduction (before evidence) — CONFIRMED

Profile `lost-response`: the first new operation **commits at the bank and then returns 504**. Script: `scripts/repro-double-debit.ts` (`node --import tsx scripts/repro-double-debit.ts` with the services up).

```text
intent: repro-double-debit-1790609703536
transfer: acc-lucia -> acc-bruno amount €1.00
balance before:              €4007.50

[1st attempt, same intentId] app status: completed
balance after 1st attempt:   €4005.50  (delta -€2.00)

[retry, same intentId]       app status: completed
balance after retry:         €4004.50  (delta -€3.00)

=== VERDICT ===
DOUBLE DEBIT CONFIRMED: one €1.00 intention debited €3.00.
```

**Result: a €1.00 intention debited €3.00** — TRIPLE debit, from the composition of three defects:

1. `dispatch.ts:5-9`: the internal retry on 504 generates a **new reference** → the bank (idempotency on `actor+reference`) treats it as a different operation → 2nd debit. The app returned `completed` (the 2nd attempt did respond) even though the customer paid twice.
2. `actions.ts:22-45`: the retry with the same `intentId` does not check `intents.status` → it dispatches again → 3rd debit.
3. `intents.bank_reference` is overwritten on every attempt → the original reference (which was already committed at the bank) is lost for reconciliation.

Note: the app reported `completed` in both cases; the real balance is only visible at the bank. The reported status does not reflect verified facts.

### Fix (implemented)

**Core: one reference per intent, forever.** The bank guarantees that reusing `actor+reference` with an identical payload returns the original operation (`replay:true`) — that turns any retry (internal or of the intent) into a safe query:

1. `src/banking/dispatch.ts` — new function `stableReference(intentId)`: reads `intents.bank_reference`, generates a UUID only if it is null and persists it once. Both the internal retry (both attempts share the reference) and re-dispatching across calls reuse it.
2. `src/banking/actions.ts` — gates by intent status:
   - `completed` → returns the stored result (enriched with the real operation via `GET /v1/operations/:reference`); never re-dispatches.
   - `processing` → reconciles via `GET /v1/operations/:reference`; never re-dispatches.
   - `created`/`failed` → proceeds, always with the stored reference.
   - Shared helper `reconcileOutcome`: operation found → `completed` (verified fact); 404 → `failed` (verified absence); query fails → non-terminal `processing` status with the reference to verify later. **Never reports `failed` without evidence.**
3. `tests/invariants.test.ts` — 4 regression tests with an in-process fake bank (no live services), written test-first (RED observed before the fix): lost-response debits exactly once; rejection before commit → verified `failed`; commit unreachable → recovered to `completed`; unverifiable outcome → `processing` and the retry never re-dispatches.

### Verification (after) — CONFIRMED

- `npm run typecheck` ✅ · `npm test` → **17/17** (13 original + 4 new) ✅
- End-to-end repro with the same script and profile `lost-response`:

```text
balance before:              €4002.50
[1st attempt, same intentId] app status: completed
balance after 1st attempt:   €4001.50  (delta -€1.00)
[retry, same intentId]       app status: completed
balance after retry:         €4001.50  (delta -€1.00)
=== VERDICT ===
No double debit observed (fixed?).
```

- Normal transfer under profile `normal`: `completed`, exact delta of 100 cents (no regression).

**Before/after**: €1.00 of intention → €3.00 debited and misleading statuses **before**; €1.00 debited exactly once, retry without additional effects and status always verified **after**.

---

## 3. Bug 2: Stale documentation in assistant answers

**Date**: 28-09-2026 · **Severity**: high (traceable evidence) · **Status**: RESOLVED · **Branch**: `fix/stale-doc-retrieval`

### The problem

The contract requires: *"Assistant information should rely on applicable documentation and make its evidence traceable"* and warns that *"Documents can contain historical versions"*. The corpus includes 80 documents with historical and archived versions (`archive-*`, in force until 2026-08-31), and the exercise's reference date is **2026-09-24** (`src/config.ts:18`).

### Root cause (code reading)

1. `src/ingestion/chunker.ts:13-16`: `title/version/validFrom/validTo` were only populated on the offset-0 chunk; the rest stayed `null` → the UI showed "Version —" and per-chunk currency filtering was impossible.
2. `src/retrieval/search.ts:18`: it only filtered by audience (`public`/operator). Archived and superseded documents competed in the ranking with the in-force policy → the assistant could answer with expired fees/rules.

### Fix (implemented)

1. `chunker.ts`: document metadata propagated to **all** chunks. The chunk id is `sha256(docId:offset:text)` (without metadata) → stable ids, the embeddings cache keeps working (re-ingestion at no API cost).
2. `search.ts`: currency filter on `referenceDate` with inclusive bounds and `null` = open (`validFrom <= ref && (validTo == null || validTo >= ref)`), on top of the audience filter. Uniform `YYYY-MM-DD` format across the corpus (verified) → exact lexicographic comparison.
3. Re-ingestion + export of the portable index (356 chunks, all with full metadata).

### Verification (after) — CONFIRMED

- `npm test` → **19/19** (2 new tests: metadata propagation; expired document with score 1.0 excluded even though it would win the ranking, cached synthetic vector → zero API calls).
- Live search `POST /api/search {"query":"Aurora account fees"}` (client):

```text
aurora-fees-2026        | v2 2026-09-01 -> None | 0.688
aurora-operations-2026  | v2 2026-09-01 -> None | 0.627
faq-aurora-waiver       | v2 2026-09-01 -> None | 0.621
aurora-conditions-2026  | v2 2026-09-01 -> None | 0.605
aurora-fees-2026        | v2 2026-09-01 -> None | 0.576
```

Zero `archive-*` results; all chunks with version and currency populated (`GET /api/documents/:id/chunks`).

### Design note

The currency filter also applies to the operator role. The document library (`GET /api/documents`) still shows the WHOLE corpus including historical documents; only the *search that feeds answers* uses in-force documents exclusively. If operators were to search historical versions, that would be a separate product decision.

---

---

## 4. Part 2 — Trust Layer (distinctive feature)

**Date**: 28-09-2026 · **Status**: IMPLEMENTED · **Branch**: `feature/trust-layer` (commits `1b1099a` + `53d3333`)

### The idea

A trust layer on top of the assistant that covers two unmet contracts at once:

1. **Confirmation cards**: the agent NEVER moves money without explicit review — it creates a proposal (amount/source/destination) that expires in 10 minutes, the customer confirms it in the "Proposals awaiting confirmation" panel, and only then is it dispatched with exactly-once guarantees. Receipt with a `reference` verifiable via `operation_status`.
2. **Answers with verifiable citations**: every policy/fee/limit claim carries a `[docId vN]` citation rendered as a clickable chip that opens the cited document in the library. Without evidence → admit it and offer a next step. Making up fees or "typical banking practices" is forbidden.

### Why it is distinctive

- It is not a generic chatbot: **every answer is auditable** (citation → document → version → currency) and **every operation is reversible at a glance** (proposal → confirmation → receipt).
- It composes everything built before: in-force documents (Bug 2), exactly-once intents (Bug 1) and now explicit review — the demo chains all three.

### Implementation

**Backend (`1b1099a`)** — `src/banking/authorization.ts` + `app/api/[...path]/route.ts`:
- `authorizeTransfer` without `approvalId` → creates/reuses a pending proposal per intent (10 min TTL) and returns `requires_confirmation` **without dispatching**.
- Confirm path → validates 404/409-consumed/410-expired/409-altered-payload and consumes **atomically** (`UPDATE ... WHERE consumed_at IS NULL` + `changes===1`).
- 5 new TDD tests; the previous exactly-once tests updated to go through confirmation (guarantees intact). **25/25 tests**.

**Agent + UI (`53d3333`)** — `src/agent/prompt.ts` + `src/agent/run.ts` + `app/page.tsx`:
- Evidence-first stance: in-force sources > background knowledge; mandatory citations; no evidence → admit it + next step (`request_human` / Documents section).
- A `requires_confirmation` transfer → the agent explains that it was **not** executed and asks to confirm in the panel.
- Accessible citation chips (aria-label) that open the cited document.

### UX polish (branch `feature/confirmation-ux`, commit `4236adf`)

**Finding from the first real UI session**: the flow worked correctly (4 proposals confirmed and executed exactly once), but the proposal only appeared in the bottom panel, out of view, without indicating its expiry — the transfer looked "hung". Improvements applied (`app/page.tsx` only):

- **Inline card** under the transfer form (amount, source→destination with names, concept) with Confirm and Discard, and auto-scroll when it appears.
- **Live countdown** (m:ss) on the card and on every proposal in the panel.
- **Expired state** with a "Request again" button that re-fills the form with the same data.
- Explicit outcomes: success clears the card; "already confirmed" clears and refreshes; "expired" switches to re-request mode.

This is also video material: it shows the full cycle **real feedback → diagnosis with evidence (DB + logs) → product improvement**.

**Second iteration (same day, commit `0a01b4f`)**: in the real test, the user confirmed from the panel and the transfer executed, but **the chat did not reflect it** — it kept saying "has not been sent", with no receipt and no way to confirm from the conversation itself. Diagnosis with evidence: approval `4e31a8bf` consumed + intent `completed` in the DB vs. the last assistant message frozen at the pre-confirmation notice. Fix:

- The conversation now returns `pendingApprovals` and the chat shows **the confirmation card inside the conversation** (same countdown/Confirm/Discard/retry, a single state and a single interval shared with the form and the panel).
- On confirm, the backend adds **one verified receipt** to the thread: amount, concept, real reference and account labels resolved from the bank (fallback to ids; never invented). Nothing is added if the outcome is not `completed`.
- The conversation reloads itself after confirming → the receipt appears without refreshing, and the operator sees it in the history.

Verified: 3 new tests (32/32), live cycle via API (proposal → `pendingApprovals` → confirm → receipt with reference → second confirm 409 with no extra message).

**Third iteration (same day, commit `fcd0405`)**: when testing "Discard", the user reported that the proposal kept appearing for confirmation, even outside the conversation. Cause: Discard was cosmetic (it hid the card locally) and the proposal stayed alive on the server — the `approvals` table had no cancellation state. Fix:

- `cancelled_at` column on `approvals` with an **idempotent migration** (`PRAGMA table_info` + guarded `ALTER TABLE`) for existing databases.
- `POST /api/approvals/:id/cancel`: atomic (`UPDATE ... WHERE consumed_at IS NULL AND cancelled_at IS NULL`) and idempotent cancellation; 409 if it was already confirmed; 404 for proposals that are not one's own.
- `cancelled_at IS NULL` filters in the dashboard, in the conversation's `pendingApprovals` and in confirm (which now answers with a clear message and **executes nothing**).
- UI: Discard calls the endpoint, shows "Proposal discarded. The transfer was not sent." and refreshes panel + conversation.

Verified live: cancel → it disappears on both sides; re-cancel is idempotent; confirming the cancelled one → 409 with no debit (balance intact); 5 new tests (**37/37**).

**Fourth iteration (commit `959c4c5`)**: the discard also had to be recorded in the chat (like the confirmation receipt). A cancellation message is added, built only from the stored payload — *"Transfer cancelled: EUR 4.50 from your Aurora account to Bruno Vidal's Horizon account (concept: parent cancel msg) was not sent. No money has moved."* — exactly once per cancellation (no duplicates on re-cancel), with labels resolved from the bank and fallback to ids. 3 new tests (**40/40**).

**Fifth iteration (commit `221ecf7`)**: the user reported that the confirmation card no longer appeared when requesting a transfer. Diagnosis with the `events` table (the correct observable for the agent's tool calls): the conversation showed **only `list_accounts`**, with no `transfer_money` event and no intents — the model answered in prose promising a confirmation it never created. Cause: the evidence-first prompt described the behavior after `requires_confirmation` without requiring the tool call. Fix: imperative rules (call `transfer_money` in the same turn with complete data; never present a prose summary as a proposal; citations only for documentation). Verified live with the correct observable: `list_accounts → transfer_money → requires_confirmation` + a real proposal in the conversation. 40/40 tests.

**Sixth iteration (commit `b6b953e`)**: the user saw pending proposals in the panel that did not belong to their conversation — they were **leftovers from the smoke tests** run by the assistant and the worker against the same user (cleaned via the API: 0 pending; 4 empty test conversations were also removed). Two underlying product problems were also fixed:

- **Proposal accumulation**: every agent turn created a new proposal, so retries piled up. Now, within a conversation, an **identical request reuses** the existing proposal (same `approvalId`) and a **different one supersedes it** (the previous one is silently cancelled, with no chat message). The UPDATE is scoped by `intents.conversation_id`, so it never touches other conversations or proposals without a conversation.
- **Duplicate panel**: "Proposals awaiting confirmation" was also rendered under the chat, competing with the inline card and showing proposals from other conversations. It now lives only in Overview; in the chat the card rules.

Verified live: different payload → 1 pending and the superseded one answers 409; identical payload → same `approvalId`; conversation and dashboard show exactly one. 4 new tests (**44/44**).

**Method lesson**: do not pollute demo data with smoke tests — clean up the proposals after every verification.

### Demo script for the video (suggested script)

1. **Verifiable citation**: "What is the monthly fee of the Aurora account and when is it waived?" → answer with chip `[aurora-fees-2026 v2]` → click → opens the document in the library. (Verified: the answer cites the exact conditions — €6/month, waived with salary ≥€1.200 + 3 purchases.)
2. **No invention**: "Can I transfer 999 million euros?" → cites the documented limit instead of inventing one (`[aurora-operations-2026 v2]`).
3. **Explicit confirmation**: "Send 1 euro from my Aurora account to Bruno, concept coffee" → the agent shows the proposal and clarifies it was NOT executed → "Proposals awaiting confirmation" panel → Confirm → receipt with reference.
4. **Double-confirm blocked**: second click on Confirm → 409 "This proposal was already confirmed."
5. **Exactly-once under failure**: with `npm run scenario -- lost-response`, repeat the flow → exactly €1 debited (`scripts/repro-double-debit.ts` prints "No double debit observed").
6. **Closing**: balances consistent between UI and bank at all times.

---

## 5. Bug 3 (remainder) + Bug 4: Operator visibility and telemetry

**Date**: 2026-09-28 · **Severity**: medium-high (case resolution) · **Status**: RESOLVED · **Branch**: `fix/operator-visibility` (commit `691c5b1`)

### The problem

The contract requires: *"Operators need to understand the conversation, relevant steps, and effects"* and *"Historical evidence that was never recorded must not be invented"*. But:

1. `src/operator/view.ts`: `caseDetail` returned hardcoded `history: [], events: [], intents: [], bank: null` — the case view was decorative.
2. `src/telemetry.ts`: `recordEvent` received full args/outputs/duration and persisted only `{tool, status}` — evidence was discarded as it was recorded.
3. No route mutated `incidents.status` — **cases could never be closed**.
4. The bank's operator endpoint (`GET /v1/operator/customer`) was never called by the app.

### Fix (implemented)

- Telemetry with full payload (args, outputs, durationMs verbatim).
- `caseDetail` populated: conversation (last 50, chronological order), events (last 100 with parsed payloads), intents (status/reference/operation_id) and real bank operations (signing actor = operator).
- **Honest gaps**: with no recorded activity or a bank failure it is **declared** in `gaps`; malformed JSON is shown as-is, never dropped or invented.
- `POST /api/incidents/:id/close` (operator; 404/409) + "Resolve case" button in the UI.

### Verification (after) — CONFIRMED

- `npm test` → **29/29** (4 new tests: full telemetry; populated caseDetail with operator-actor assertion; bank down → gaps without fabrication; closing 404/403/200/409).
- Live: case created by Lucía (€1 transfer + request_human) → Marta sees 2 messages, 8 events with `arguments/output/durationMs`, 9 bank operations including the €1.00 one with its reference → closes the case → second close → 409.

```text
history: 2 | events: 8 | intents: 1 | bank ops: 9
sample event data keys: ['tool', 'status', 'arguments', 'output', 'durationMs']
bank op: {'amountCents': 100, 'status': 'completed', 'reference': 'ba169fdb-...'}
status: closed
```

### Demo note

This fix closes the video's loop: the same case shows the confirmation proposal in the telemetry (`requires_confirmation` with approvalId), the confirmation, the exactly-once operation and the closing by the operator — all with recorded evidence, not narrated.

---

## 6. Part 2 (extension) — Fee Coach

**Date**: 2026-09-29 · **Status**: IMPLEMENTED · **Branch**: `feature/fee-coach` (commit `17a0b34`)

### The idea

*"¿me van a cobrar comisión este mes?"* — the agent **cross-references the customer's real movements with the in-force policy** and answers with the figure, the conditions evaluated one by one and the document citation. **The decision is made by pure, testable code; the model only presents it.**

### Why it is distinctive

A generic chatbot can *explain* the fee policy; this one **evaluates it against the customer's ledger**. And it composes everything built before: verified ledger (exactly-once and reconciliation), documents filtered by currency, traceable citations and explicit honesty about what cannot be known.

### How it decides (no LLM)

`src/banking/feePolicy.ts`, a pure, side-effect-free function:

1. **Account label → product** (`"Aurora account"` → `aurora`).
2. **In-force document** from the index, with the same currency semantics as search (at reference date 2026-09-24); `archive-*` documents are **never** candidates.
3. **The fee is parsed from the document TEXT**, not from a hardcoded table: it covers `"The Aurora account monthly fee is EUR 6."` and `"The monthly fee for Horizon is EUR 3."`. If the text does not declare it → `undetermined`, never an invented figure.
4. **The waiver rule also comes from the text**: only Aurora has one; the other documents explicitly deny it. Parsed thresholds: `EUR 1,200` and `three settled card purchases`. If it mentions a waiver that cannot be parsed → `undetermined`.
5. **Conditions against the customer's movements of the month**: salary (positive with `salary`, ≥ threshold) and card purchases (negatives excluding transfers and the initial balance), with the real evidence cited.
6. **Honest `caveats`**: the ledger **does not record settlement status** (posted movements are treated as settled) and postings near the month boundary may fall into the adjacent month.

### Verification

- **52/52 tests** (8 new): parsing of the five real in-force documents (**Aurora 6 · Horizon 3 · Cloud 0 · Community 2 · Family 5**), waiver detected only in Aurora, condition matrix with synthetic ledgers (with/without salary, 0–4 purchases, transfers excluded), savings account → `undetermined`, **archived document never selected**, settlement caveat, unparseable waiver → `undetermined`, and the tool end-to-end against the fake bank.
- **Live (real model)**:

```text
"Will I be charged a fee for my Aurora account this month?"

For your Aurora account, the fee for September is EUR 0. Both waiver
conditions were met: a salary payment of EUR 1,750 (minimum EUR 1,200)
and four card-like purchases (minimum three) [aurora-fees-2026 v2].

Caveats: Posted movements are treated as settled because the ledger
does not record settlement status. …

"…my Personal savings account…"
Personal savings: Undetermined. No in-force fee policy was found for
this account, so I can't confirm whether you'll be charged. …
```

Accuracy note: on a first pass the model attached the Aurora citation to the savings account's caveat (misattributed citation). The prompt guide was tightened — a citation may only accompany the claim it supports — and it was re-verified: the savings answer no longer cites any policy.

### Declared limits

- The parsing tolerates the current corpus, not any future wording: faced with a rephrasing it falls back to `undetermined` (safe, though silent), and there is a test that pins that behavior.
- The evaluated month derives from the reference date (2026-09-24), not the real clock; a real deployment should change the source of "now".
- `/v1/movements` returns up to 100 movements: a very active account could push the month's purchases out of the window.


---

## Final state: done / verified / pending

### Done

**Part 1 (launch readiness)** — 4 defect families fixed, each mapped to its clause in §0:
1. Multiple debit on retries → exactly-once with a stable reference, intent gates and reconciliation of unknown outcomes.
2. Stale documentation feeding answers → per-chunk metadata + currency filter at the reference date + re-ingestion of the index.
3. Missing explicit confirmation → proposals with expiry, atomic consumption, real cancellation (Discard), reuse/supersede and outcome recorded in the conversation.
4. Blind operator → full telemetry, case detail with conversation/activity/bank operations, honest "gaps" and case closing.

**Part 2 (distinctive feature)** — *Trust Layer*: inline confirmation in the chat with countdown and re-request + answers with verifiable citations (document, version, currency) and no-evidence behavior. **Extension**: *Fee Coach* — a deterministic rules engine that cross-references the customer's ledger with the in-force policy (§6).

### Verified

- **52 tests** in `npm test` (all pass) + clean `npm run typecheck`.
- **Reproducible reproduction of the critical bug**: `scripts/repro-double-debit.ts` (€1.00 → €3.00 before; exactly €1.00 after).
- **Measured before/after eval** (§0c): BEFORE 1/14 pass · 0/14 cite → AFTER 14/14 pass · 12/12 of the required citations; 28 answers with no invented figure.
- **The starter's own seeded cases** (§0b) re-verified live after the fixes.
- **Full functional walkthrough**: request → card → confirm (receipt with reference) → discard (recorded) → expire (re-request) → audit in the operator view and close the case.

### Pending (declared)

1. **`intentId` per form submission**: today the endpoint generates a random one per submit; the proposal flow + one-proposal-per-conversation mitigates it (no automatic double debit), but a double click without confirming can leave two proposals if there is no open conversation.
2. **Section-based chunking and product prefix when embedding**: it would improve retrieval precision (the boilerplate shared by the 80 documents dominates the embeddings). Not addressed; the currency filter and the citations already prevent the material error.
3. **Historical retrieval**: archived documents are not retrieved for genuinely historical questions (limit declared in §0c).
4. **Delivery**: record the video (script in §4), merge the branch chain to `dev` and package the ZIP (without `.env*`, `node_modules/`, `.next/`, `.git/`, `.data/`).
5. **Unaddressed minor findings** (documented, not fixed): the agent loop runs out of signal when it exhausts its 7 rounds; `bankRequest` may throw if a 5xx carries no JSON; `/api/people` does not require a session.
