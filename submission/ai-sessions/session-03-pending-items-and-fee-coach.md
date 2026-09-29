# Session 03 — Declared pending items, Fee Coach and retrieval quality

- **Date**: 29 September 2026
- **Tool**: pi coding agent (harness), main host session + subagents (implementation workers)
- **Language**: conversation in Spanish; code artifacts in English

> **Method note**: from this session on, every **work session** has its own file (before, the work of several days was grouped into a single file by phases). `session-02` covers 28-09 (phases 0–11); this file covers 29-09.

---

## User messages in this session

1. "Vamos a continuar por donde lo dejamos."
2. "levanta el proyecto para que compruebe el estado"
3. "No, si no has terminado, termina"
4. "Está todo correcto"
5. "como que los comandos exactos?" *(clarification: the ZIP is downloaded from the repository; he also asks for a document for PDF)*
6. "El zip lo descargo yo de github y ya viene sin los node modules ni el .env ni nada. Y lo del pdf tambien lo quiero. Arma un buen md explicando todo (a parte del video que voy a hacer) y lo convierto a pdf y lo incluyo"
7. *(status report of the repository and request to complete the declared pending items: `intentId` per form submission, section-based chunking and product prefix when embedding, historical retrieval, and the minor findings — signal when the agent's 7 rounds are exhausted, `bankRequest` with a non-JSON response, `/api/people` without a session)*

---

## Phase 1 — Fee Coach: deterministic engine over the ledger

**Design decision**: the **fee coach** was chosen as the Part 2 extension because it was the most distinctive proposal and because it combines ledger + RAG + honesty, with the decision made by **pure, testable code** instead of the model.

**Work**: `src/banking/feePolicy.ts` (pure engine: product from the account label, in-force document from the index with the `archive-*` excluded, fee and waiver rule **parsed from the document text**, conditions evaluated against the month's movements, honest caveats about the absence of settlement status in the ledger), `fee_status` tool (server identity), prompt guide (the model presents, it never calculates) and 8 new tests.

**Verification**: 52/52 tests, including the parsing of the five real documents (Aurora 6 · Horizon 3 · Cloud 0 · Community 2 · Family 5) and that the archived one (EUR 8) is never selected; live with the real model, Lucía gets **EUR 0** with both conditions met and citation `[aurora-fees-2026 v2]`, and her savings account returns `undetermined` with no invented figure.

**Correction detected in the parent's review**: on a first pass the model attached the Aurora citation to the savings account's caveat (misattributed citation). The guide was tightened (a citation may only accompany the claim it supports) and it was re-verified: the savings answer no longer cites any policy.

**Declared limits**: parsing tolerant to the current corpus (faced with rephrasings it falls back to `undetermined`, with a test that pins it), evaluated month derived from the reference date and the 100-movement window of `/v1/movements`.

## Phase 2 — Environment configuration hardening

**Context**: the failure that blocked the project on day one (the **empty** `OPENAI_API_KEY=` that `setup.ts` wrote into `.env.local`, which masked the real key from `.env` because `config.ts` loads `.env.local` first and dotenv does not override already-defined variables) had been diagnosed and resolved on the machine, but **it was not fixed in the code**. Anyone cloning the submission and configuring the key through the natural route (`.env` or an environment variable) would have hit the same confusing error on their first `npm run doctor`.

**Work** (branch `fix/env-precedence`, from `dev`): `scripts/setup.ts` now writes `.env.local` from the example with the `OPENAI_API_KEY` line **commented out**, so the key can come from `.env.local`, from `.env` or from the environment without an empty value masking it; and `README.md` documents the precedence rule and the trap.

**Verification**: `.env.local` was deleted, `npm run setup` was run and the generated file was confirmed to contain `# OPENAI_API_KEY=`; the original `.env.local` was restored **byte-identical** (verified with `diff`). `npm run typecheck` and `npm test` (44/44 on that branch) green.

**Method note**: a dedicated branch from `dev` was chosen instead of squeezing it into the fee coach branch, to avoid mixing an environment fix with a product feature.

## Phase 3 — Submission documentation

**Context**: the brief asks to explain the work and list the included materials, and the user additionally wants a document to convert to PDF and include in the submission.

**Work**:
- `submission/EXPLANATION.md` (276 lines, in English as the evaluator's language): summary and scorecard, quick start with the `.env` precedence trap, each defect family mapped to its `contracts.md` clause with root cause, fix commit and before/after evidence, the starter's own seeded evidence, the Trust Layer and the Fee Coach, the working method, a *claim → how to reproduce it* table, the measurement with its honest reading and the instrument's bias, the declared limits, a guided 5-minute demo and the branch/commit/file map.
- `submission/README.md`: submission inventory with relative paths of everything included, project files that carry the work, exclusions and what is missing (the video).
- `submission/VIDEO-SCRIPT.md`: recording script in Spanish, with timings, exact commands, prompts to type and expected outputs; it includes the pre-upload checklist.

**Language decision**: the documentation the evaluator reads (`EXPLANATION.md`, `README.md`) is in English; the video script is in Spanish because it is what is spoken on camera.

**Pending at the time of writing this phase**: the session's declared pending items (see Phases 4 and 5).

## Phase 4 — Closing the declared pending items (block 1)

**Scope** (branch `fix/form-intent-and-minors`, from `master`):

1. **`intentId` per form submission**: the transfer form keeps the identity of its submission (same payload signature → same `intentId`) and sends it to the endpoint; on the server, the no-conversation path reuses an identical pending proposal from the same user. Result: a double click does not create two proposals.
2. **Signal when the agent's rounds are exhausted**: when the loop ends with pending tool calls, a telemetry event is recorded and the final answer explains that the request could not be completed and offers a concrete next step.
3. **`bankRequest` with a non-JSON response**: it is parsed defensively and a `BankError` is thrown with the real status and a clear message instead of a loose `SyntaxError`.
4. **`/api/people` without a session**: it stays public (the people selector must work before a session exists; it is a convenience of the local simulator, not authentication), but it is now **documented in the code** and **pinned by a test**, so it is an explicit decision rather than an omission.

**Verification**: pending closure within this same session.

## Phase 5 — Retrieval quality and historical retrieval

**Planned scope** (dedicated branch from `master`):

1. **Section-based chunking**: split by `##` headers instead of fixed 650-character windows, with sub-splitting when a section is too long.
2. **Product prefix when embedding**: embed `title · documentId · version` alongside the text, without polluting the text that is displayed and cited (the boilerplate shared by the 80 documents currently dominates the embeddings).
3. **Historical retrieval**: deterministic historical-intent classifier on the query that enables including expired documents, marked as historical and with the instruction to declare them as such (today they are excluded entirely).

**Planned verification**: chunking and classification tests, search with and without historical intent, re-ingestion with `--export`, and **re-running the eval** (`REPEATS=2`) to measure the effect on precision and citations.

## Pending items at the close of this session

1. Close Phase 4 (live verification) and Phase 5.
2. Record the video following `VIDEO-SCRIPT.md`.
3. Package the submission ZIP (downloaded from the repository) with the PDF and the video inside `submission/`.
