# Feature: Part 1 — Transfer integrity (doble débito, intents y reconciliación)

Branch base: `dev` (convención del proyecto: features salen de dev, todo pasa por dev antes de master).

## Objetivo

Garantizar que una intención de transferencia produce **exactamente un** débito, y que el estado que ve el cliente refleja solo hechos verificados del banco.

## Tareas

- [ ] 1. Reproducir el doble débito con perfil `lost-response` (evidencia before/after guardada en `submission/work-log.md` y script `scripts/repro-double-debit.ts`).
- [ ] 2. Fix: reference estable por intent en `dispatch.ts` (no regenerar en reintentos; no sobrescribir `intents.bank_reference`).
- [ ] 3. Fix: no re-despachar intents con estado `completed`/`processing` en `actions.ts` (verificar status del intent).
- [ ] 4. Fix: reconciliación del resultado desconocido tras 504/timeout vía `GET /v1/operations/:reference` (`operation_status`) antes de marcar failed.
- [ ] 5. Test de regresión automatizado del doble débito.
- [ ] 6. Work-unit commit(s) en rama de feature sobre `dev`, con tests y doc.

## Evidencia

- Repro before: (pendiente)
- Commits: (pendiente)

## Notas

- El escenario `intermittent` (seed 17) es el perfil por defecto tras `reset`; para el repro determinista se usa `lost-response`.
- Los endpoints admin del simulador (`/admin/*`) NO pueden usarse desde la app para completar operaciones (contrato). Solo para configurar escenarios de test.
