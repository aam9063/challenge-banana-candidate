# Feature: Part 1 — Operator visibility (Bug 4: stub case view + lossy telemetry)

Branch: `fix/operator-visibility` (stacked on `feature/trust-layer`).

## Goal

Let operators resolve cases with real evidence, satisfying the contract: *"Operators need to understand the conversation, relevant steps, and effects. Historical evidence that was never recorded must not be invented."*

## Tasks

- [x] 1. `telemetry.ts`: persist the full event payload (args, outputs, durationMs) instead of collapsing it to `{tool,status}`.
- [x] 2. `operator/view.ts` `caseDetail`: populate `history` (conversation messages), `events` (real telemetry), `intents` (transfers with status/reference) and `bank` (via `GET /v1/operator/customer?id=...`); on bank failure → `bank: null` plus an honest note in `gaps` (never invent).
- [x] 3. `POST /api/incidents/:id/close` endpoint (operator) + "Resolve case" button in the UI.
- [x] 4. Regression tests (full telemetry, populated case detail, case closing, bank down → gaps).
- [x] 5. Live verification: a case created from a real transfer → the operator sees conversation/activity/operations → closes the case.
- [x] 6. Work-unit commit + `submission/work-log.md` §5.

## Notes

- The UI already rendered `history/events/bank.operations/gaps` (`page.tsx:848-880`) — no redesign needed, only data.
- "Closed" status = `status:'closed'` (the UI and the seed already use it: 8 resolved cases).
- Verify the exact response shape of `/v1/operator/customer` in `simulator/server.ts:150-161` (contract: operators only).
