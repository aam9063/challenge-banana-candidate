# Feature: Part 1 — Applicable-document retrieval (docs caducados)

Branch: `fix/stale-doc-retrieval` (apilada sobre `fix/transfer-idempotency` por archivos compartidos de submission; independencia funcional total).

## Objetivo

Que el asistente solo recupere documentación **vigente a la fecha de referencia** (2026-09-24), con metadatos de versión trazables en cada chunk, cumpliendo el contrato: *"Assistant information should rely on applicable documentation and make its evidence traceable"* y *"Documents can contain historical versions"*.

## Tareas

- [x] 1. `chunker.ts`: propagar `title/version/validFrom/validTo` del documento a TODOS los chunks (hoy solo offset 0; el resto queda null → UI "Version —", filtrado imposible).
- [x] 2. `search.ts`: filtrar chunks por vigencia en `config.referenceDate` (validFrom <= ref && (validTo == null || validTo >= ref)), manteniendo el filtro de audiencia.
- [x] 3. Re-ingesta: `npm run ingest` + `npm run ingest -- --export` (embeddings cacheados → sin coste de API; actualiza índice portable de fixtures).
- [x] 4. Tests de regresión: metadatos en todos los chunks; búsqueda excluye documentos caducados.
- [x] 5. Verificación: typecheck + tests + búsqueda en vivo sin resultados caducados.
- [ ] 6. Work-unit commit + documentación en `submission/work-log.md` §3.

## Notas

- El id de chunk es `sha256(docId:offset:text)` — no incluye metadatos → ids estables, el cache de embeddings sigue funcionando.
- `config.referenceDate = '2026-09-24'` (config.ts:18). Confirmar formato de fechas en `fixtures/documents/manifest.json`.
- Verificar formato real de `validFrom/validTo` (¿solo fecha o ISO datetime?) antes de comparar strings.
