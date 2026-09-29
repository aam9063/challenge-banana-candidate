# Feature: Part 2 — Trust Layer (confirmation cards + cited answers)

Branch: `feature/trust-layer` (stacked on `fix/stale-doc-retrieval` ← `fix/transfer-idempotency` ← `dev`).

## Goal

A trust layer over the agent that closes two unmet contracts:

1. **Explicit confirmation of sensitive operations**: *"A sensitive operation must present its amount, source, and destination for explicit review before execution. An informational conversation alone does not authorize payment."* — the agent NEVER transfers without a confirmed proposal. (This also fixes Bug 3: the dead approval flow.)
2. **Traceable evidence in answers**: *"Assistant information should rely on applicable documentation and make its evidence traceable. Missing evidence should be acknowledged with a useful next step."* — citations with document/version/validity; when there is no evidence it is acknowledged and a next step is offered.

## Tasks

- [x] 1. **Approval flow (backend)**: `authorizeTransfer` creates a pending proposal (id, intent, payload, expires in 10 minutes) and returns `requires_confirmation`; with `ctx.approvalId` it validates integrity/expiry/consumption (atomic) and lets the dispatch proceed. The confirm endpoint checks `consumed_at`/`expires_at`. Idempotent per intent (a retry returns the same proposal). TDD tests.
- [x] 2. **Verifiable citations (agent + UI)**: hardened prompt (`[docId vN]` citations mandatory on policy claims, inventing fees/estimates forbidden, no evidence → admit it + next step). The UI renders citation chips in assistant messages.
- [x] 3. End-to-end verification of both + demo script for the video.
- [x] 4. Separate work-unit commits (backend / citations) + documentation in `submission/work-log.md` §4.

## Design decisions

- **Every** transfer requires confirmation (the contract says "a sensitive operation"; there is no evident safe threshold — keep it simple and safe).
- Result status: `requires_confirmation` (already handled by `app/page.tsx:260`).
- Approval: expires in 10 minutes; atomic consumption (`UPDATE ... WHERE consumed_at IS NULL` + `changes===1`).
- The confirm endpoint checks `consumed_at`/`expires_at` BEFORE calling `transferMoney` (409/410); `authorizeTransfer` verifies payload integrity.
- The confirmation card reuses the existing "Proposals awaiting confirmation" panel (`page.tsx:720+`).
- Citations: the `search_documents` output already includes documentId/title/version/validFrom/validTo — the model has everything it needs to cite.

## Notes

- `ToolContext.approvalId` already exists in the types and the route already passes it.
- No re-dispatching: the intent gates from the previous branch still apply (completed → stored result).
