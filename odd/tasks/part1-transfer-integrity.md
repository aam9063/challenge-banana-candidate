# Feature: Part 1 — Transfer integrity (doble débito, intents y reconciliación)

Branch base: `dev` (convención del proyecto: features salen de dev, todo pasa por dev antes de master).

## Objetivo

Garantizar que una intención de transferencia produce **exactamente un** débito, y que el estado que ve el cliente refleja solo hechos verificados del banco.

## Tareas

- [x] 1. Reproducir el doble débito con perfil `lost-response` (evidencia before/after guardada en `submission/work-log.md` y script `scripts/repro-double-debit.ts`). CONFIRMADO: €1.00 → €3.00 (triple débito).
- [x] 2. Fix: reference estable por intent en `dispatch.ts` (`stableReference()` — no regenerar en reintentos; no sobrescribir `intents.bank_reference`).
- [x] 3. Fix: no re-despachar intents con estado `completed`/`processing` en `actions.ts` (gates por estado del intent).
- [x] 4. Fix: reconciliación del resultado desconocido tras 5xx vía `GET /v1/operations/:reference` (`reconcileOutcome()`: found→completed, 404→failed verificado, lookup falla→processing no terminal).
- [x] 5. Test de regresión automatizado (4 tests con banco fake in-process, TDD RED→GREEN, `npm test` 17/17).
- [x] 6. Work-unit commits en rama `fix/transfer-idempotency` sobre `dev`: `404847c` (chore) + `8056774` (fix).

## Evidencia

- Repro before: una intención de €1,00 (acc-lucia → acc-bruno) debitó €3,00. App reportó `completed` en ambos intentos mientras el saldo real caía €2,00 y luego €1,00 más. Ver `submission/work-log.md` §2.
- Commits: `404847c` (chore: scaffolding + repro), fix en curso en rama `fix/transfer-idempotency`.

## Notas

- El escenario `intermittent` (seed 17) es el perfil por defecto tras `reset`; para el repro determinista se usa `lost-response`.
- Los endpoints admin del simulador (`/admin/*`) NO pueden usarse desde la app para completar operaciones (contrato). Solo para configurar escenarios de test.
