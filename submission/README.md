# Submission — Banana Bank Technical Challenge

**Date**: 29 September 2026
**Project**: Banana Bank (fictional bank, AI assistant) — Parts 1 and 2
**Reading order**: start with `EXPLANATION.md`, then `work-log.md` for the chronological evidence, then `ai-sessions/` for the original conversations.

## What is included

| Relative path | Contents |
|---|---|
| `EXPLANATION.md` | Full written explanation of both parts: problems, root causes, fixes, evidence, method, verification, limitations, guided demo. **This is the document to read first** (also delivered as PDF). |
| `work-log.md` | Chronological engineering log, unit by unit: contract clause → defect → reproduction → fix → before/after verification. Includes the video script used for the demo recording. |
| `ai-sessions/README.md` | Index of the AI session exports. |
| `ai-sessions/session-01-setup-and-diagnosis.md` | Session 1: dependency-installation diagnosis (native module build toolchain), environment setup, first-run walkthrough, initial code map. |
| `ai-sessions/session-02-implementation-and-polish.md` | Session 2 (28-09-2026): Part 1 (four defect families and operator visibility), the Trust Layer, UX iterations driven by real user feedback, and the measured before/after evaluation (phases 0–11). |
| `ai-sessions/session-03-pending-items-and-fee-coach.md` | Session 3 (29-09-2026): the deterministic fee coach, the environment hardening, the delivery documentation, and the closure of the declared pending items (phases 1–5). |
| `evidence/eval-before-r2.json` | Raw evaluation results on the base commit (7 ground-truth questions × 2 repetitions). |
| `evidence/eval-after-r2.json`, `evidence/eval-after-r3.json`, `evidence/eval-after-r4.json` | Raw evaluation results on the fixed branch across the retrieval improvements. |
| `evidence/eval-before.json`, `evidence/eval-after.json` | First evaluation round (4 questions, single repetition). |

## Project files that carry the work

| Relative path | What it implements |
|---|---|
| `src/banking/dispatch.ts` | One bank reference per intention; retries reuse it. |
| `src/banking/actions.ts` | Intent status gates and reconciliation of unknown outcomes. |
| `src/banking/authorization.ts` | Proposal creation, validation and atomic consumption; cancellation semantics. |
| `src/banking/feePolicy.ts` | Deterministic fee engine: in-force policy text × the customer's ledger. |
| `src/ingestion/chunker.ts` | Document metadata on every chunk. |
| `src/retrieval/search.ts` | Retrieval restricted to documents in force at the reference date. |
| `src/operator/view.ts` | Operator case detail: conversation, activity, intents, bank operations, honest gaps. |
| `src/telemetry.ts` | Full event payloads (arguments, outputs, durations). |
| `src/agent/prompt.ts` | Evidence-first instructions, citation rules, transfer and fee protocols. |
| `src/agent/tools.ts` | `fee_status` and the existing tool set. |
| `src/db.ts` | Approvals schema + idempotent migration for cancellation. |
| `app/api/[...path]/route.ts` | Conversation pending approvals, receipts, cancellation, confirmation checks, case closing. |
| `app/page.tsx` | Confirmation card with countdown, citation chips, case resolution. |
| `scripts/repro-double-debit.ts` | Deterministic reproduction of the critical defect (before/after). |
| `scripts/eval-answers.ts` | Ground-truth answer evaluation with forbidden trap values. |
| `scripts/setup.ts` | No longer writes an empty `OPENAI_API_KEY` that shadows `.env`. |
| `tests/invariants.test.ts` | 52 automated invariants. |
| `odd/tasks/*.md` | Feature documents used while working: scope, tasks, decisions, evidence. |

## Excluded from the delivery

Credentials and local state are not part of the ZIP: `.env`, `.env.local` (only `.env.example` is included), `node_modules/`, `.next/`, `.data/` and `.git/`.

## Not included yet

The video demonstration is recorded separately and added to the final ZIP; `EXPLANATION.md` covers the same points in written form.
