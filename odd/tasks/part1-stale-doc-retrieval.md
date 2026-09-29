# Feature: Part 1 — Applicable-document retrieval (stale documents)

Branch: `fix/stale-doc-retrieval` (stacked on `fix/transfer-idempotency` because of shared submission files; the functional work is fully independent).

## Goal

Make the assistant retrieve only documentation **in force at the reference date** (2026-09-24), with traceable version metadata on every chunk, satisfying the contract: *"Assistant information should rely on applicable documentation and make its evidence traceable"* and *"Documents can contain historical versions"*.

## Tasks

- [x] 1. `chunker.ts`: propagate the document's `title/version/validFrom/validTo` onto ALL chunks (previously only offset 0; the rest stayed null → UI showed "Version —" and filtering was impossible).
- [x] 2. `search.ts`: filter chunks by validity at `config.referenceDate` (`validFrom <= ref && (validTo == null || validTo >= ref)`), keeping the audience filter.
- [x] 3. Re-ingestion: `npm run ingest` + `npm run ingest -- --export` (cached embeddings → no API cost; updates the portable fixtures index).
- [x] 4. Regression tests: metadata on every chunk; search excludes stale documents.
- [x] 5. Verification: typecheck + tests + live search with no stale results.
- [x] 6. Work-unit commit + documentation in `submission/work-log.md` §3.

## Notes

- The chunk id is `sha256(docId:offset:text)` — it does not include metadata → ids stay stable and the embedding cache keeps working.
- `config.referenceDate = '2026-09-24'` (config.ts:18). Confirm the date format in `fixtures/documents/manifest.json`.
- Verify the real format of `validFrom/validTo` (date only or ISO datetime?) before comparing strings.
