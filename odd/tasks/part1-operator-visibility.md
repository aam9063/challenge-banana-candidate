# Feature: Part 1 — Operator visibility (Bug 4: vista de caso stub + telemetría lossy)

Branch: `fix/operator-visibility` (apilada sobre `feature/trust-layer`).

## Objetivo

Que los operadores puedan resolver casos con evidencia real, cumpliendo el contrato: *"Operators need to understand the conversation, relevant steps, and effects. Historical evidence that was never recorded must not be invented."*

## Tareas

- [x] 1. `telemetry.ts`: persistir el payload completo de eventos (args, outputs, durationMs) en vez de colapsar a `{tool,status}`.
- [x] 2. `operator/view.ts` `caseDetail`: poblar `history` (mensajes de la conversación), `events` (telemetría real), `intents` (transferencias con estado/reference) y `bank` (vía `GET /v1/operator/customer?id=...`); ante fallo del banco → `bank: null` + nota honesta en `gaps` (nunca inventar).
- [x] 3. Endpoint `POST /api/incidents/:id/close` (operador) + botón "Resolve case" en la UI.
- [x] 4. Tests de regresión (telemetría completa, caseDetail poblado, cierre de caso, banco caído → gaps).
- [x] 5. Verificación en vivo: caso generado con transferencia real → operador ve conversación/actividad/operaciones → cierra el caso.
- [ ] 6. Work-unit commit + `submission/work-log.md` §5.

## Notas

- La UI ya renderiza `history/events/bank.operations/gaps` (`page.tsx:848-880`) — no requiere rediseño, solo datos.
- Estado "cerrado" = `status:'closed'` (la UI y la semilla ya lo usan: 8 casos resueltos).
- Verificar la forma exacta de la respuesta de `/v1/operator/customer` en `simulator/server.ts:150-161` (contrato: operadores only).
