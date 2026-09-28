# Feature: Part 2 — Trust Layer (confirmation cards + cited answers)

Branch: `feature/trust-layer` (apilada sobre `fix/stale-doc-retrieval` ← `fix/transfer-idempotency` ← `dev`).

## Objetivo

Capa de confianza sobre el agente que cubre dos contratos incumplidos:

1. **Confirmación explícita de operaciones sensibles**: *"A sensitive operation must present its amount, source, and destination for explicit review before execution. An informational conversation alone does not authorize payment."* — el agente NUNCA transfiere sin una propuesta confirmada. (De paso arregla el Bug 3: flujo de aprobaciones muerto.)
2. **Evidencia trazable en respuestas**: *"Assistant information should rely on applicable documentation and make its evidence traceable. Missing evidence should be acknowledged with a useful next step."* — citas con documento/versión/vigencia; sin evidencia se admite y se ofrece siguiente paso.

## Tareas

- [x] 1. **Flujo de aprobaciones (backend)**: `authorizeTransfer` crea propuesta pendiente (id, intent, payload, expira en 10 min) y devuelve `requires_confirmation`; con `ctx.approvalId` valida integridad/expiración/consumo (atómico) y permite el despacho. Endpoint confirm con checks de `consumed_at`/`expires_at`. Idempotente por intent (reintento devuelve la misma propuesta). Tests TDD.
- [ ] 2. **Citas verificables (agente + UI)**: prompt endurecido (citas `[docId vN]` obligatorias para afirmaciones de política, prohibido inventar tarifas/estimaciones, sin evidencia → admitirlo + siguiente paso). UI renderiza chips de cita en mensajes del asistente.
- [ ] 3. Verificación end-to-end de ambas + demo script para el video.
- [ ] 4. Work-unit commits separados (backend / citas) + documentación en `submission/work-log.md` §4.

## Decisiones de diseño

- **Toda** transferencia requiere confirmación (la contrato dice "a sensitive operation"; no hay umbral seguro evidente — mantener simple y seguro).
- Estado de resultado: `requires_confirmation` (ya manejado por `app/page.tsx:260`).
- Aprobación: expira en 10 minutos; consumo atómico (`UPDATE ... WHERE consumed_at IS NULL` + `changes===1`).
- El confirm endpoint verifica `consumed_at`/`expires_at` ANTES de llamar a `transferMoney` (409/410); `authorizeTransfer` verifica integridad del payload.
- La tarjeta de confirmación reutiliza el panel existente "Proposals awaiting confirmation" (`page.tsx:720+`).
- Citas: el output de `search_documents` ya incluye documentId/title/version/validFrom/validTo — el modelo tiene todo para citar.

## Notas

- `ToolContext.approvalId` ya existe en tipos y el route ya lo pasa.
- No re-despachar: los gates de intent de la rama anterior siguen aplicando (completed → resultado almacenado).
