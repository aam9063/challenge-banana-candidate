# Feature: Part 1 — Transfer integrity (double debit, intents and reconciliation)

Base branch: `dev` (project convention: features branch off dev, everything goes through dev before master).

## Goal

Guarantee that one transfer intention produces **exactly one** debit, and that the status the customer sees reflects only verified facts from the bank.

## Tasks

- [x] 1. Reproduce the double debit with the `lost-response` profile (before/after evidence recorded in `submission/work-log.md` and script `scripts/repro-double-debit.ts`). CONFIRMED: €1.00 → €3.00 (triple debit).
- [x] 2. Fix: one stable reference per intent in `dispatch.ts` (`stableReference()` — never regenerate on retries; never overwrite `intents.bank_reference`).
- [x] 3. Fix: do not re-dispatch intents in `completed`/`processing` state in `actions.ts` (intent-status gates).
- [x] 4. Fix: reconcile the unknown outcome after a 5xx via `GET /v1/operations/:reference` (`reconcileOutcome()`: found → completed, 404 → verified failed, lookup failure → non-terminal processing).
- [x] 5. Automated regression test (4 tests with an in-process fake bank, TDD RED→GREEN, `npm test` 17/17).
- [x] 6. Work-unit commits on branch `fix/transfer-idempotency` over `dev`: `404847c` (chore) + `8056774` (fix).

## Evidence

- Repro before: a €1.00 intention (acc-lucia → acc-bruno) debited €3.00. The app reported `completed` on both attempts while the real balance dropped €2.00 and then another €1.00. See `submission/work-log.md` §2.
- Commits: `404847c` (chore: scaffolding + repro), fix on branch `fix/transfer-idempotency`.

## Notes

- The `intermittent` scenario (seed 17) is the default profile after `reset`; the deterministic reproduction uses `lost-response`.
- The simulator's admin endpoints (`/admin/*`) must NOT be used from the application to complete operations (contract). They are only for configuring test scenarios.
