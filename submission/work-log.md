# Banana Bank — Work Log (video material)

> Registro cronológico y verificable de todo el trabajo de la Parte 1 y Parte 2.
> Cada entrada es material directo para el video explicativo: problema → evidencia → causa raíz → arreglo → verificación.
> Las sesiones de IA completas están en `submission/ai-sessions/`.

## Índice

1. [Setup y diagnóstico de instalación](#1-setup-y-diagnóstico-de-instalación)
2. [Bug 1: Doble débito en reintentos de transferencia](#2-bug-1-doble-débito-en-reintentos-de-transferencia)
3. [Bug 2: Documentación caducada en las respuestas](#3-bug-2-documentación-caducada-en-las-respuestas-del-asistente)
4. [Parte 2: Trust Layer](#4-parte-2--trust-layer-feature-distintiva)

---

## 1. Setup y diagnóstico de instalación

**Fecha**: 28-09-2026

**Problema**: `npm ci` fallaba en Windows (Node 24.18.0).

**Diagnóstico** (comandos reproducibles):
1. `npm ci` → `node-gyp ERR! find VS ... missing any VC++ toolset` — el compilador de C++ no estaba instalado.
2. `prebuild-install` manual → **404**: no existe prebuild de `better-sqlite3@13.0.3` para Node 24 (ABI v137) en win32-x64, por lo que npm siempre caía a compilar con node-gyp.
3. `npm install --ignore-scripts` → los otros 32 paquetes instalaban sin problemas; el único bloqueo era el módulo nativo.

**Arreglo**: instalación del workload *"Desktop development with C++"* (`Microsoft.VisualStudio.Workload.NativeDesktop`) sobre el VS 2022 Community existente. Después: `npm ci` → 0 errores, 0 vulnerabilidades.

**Segundo problema**: `npm run doctor` fallaba con `connection_or_configuration_error` aunque la key estaba en `.env`.
**Causa raíz**: `scripts/setup.ts` crea `.env.local` con `OPENAI_API_KEY=` **vacío**, y `src/config.ts:3-4` carga `.env.local` antes que `.env`. dotenv no pisa variables ya definidas → el valor vacío tapaba la key real.
**Arreglo**: eliminar la línea vacía de `.env.local`. Doctor posterior: verde.

**Verificación final** (walkthrough del README, todo por API y UI):
- `npm run doctor` → `gpt-6-luna` responde, embeddings 1536 dims ✅
- Lucía ve 2 cuentas: Aurora €4.007,50 + Ahorros €1.000,00 ✅
- Marta (operadora) ve 17 casos de soporte ✅
- Chat: *"What accounts do I have?"* → respuesta correcta con ambas cuentas y saldos exactos ✅

---

## 2. Bug 1: Doble débito en reintentos de transferencia

**Fecha**: 28-09-2026 · **Severidad**: crítica (dinero) · **Estado**: EN CURSO

### El problema

Los contratos (`docs/contracts.md`) exigen: *"Retrying that intent must not multiply its effects"* y *"A transport error or timeout does not prove that the bank rejected the operation"*.

### Causa raíz (lectura de código)

- `src/banking/dispatch.ts:6-8`: cada intento de envío genera una **reference nueva** (`randomUUID()`), anulando la idempotencia del banco (la clave es `actor + reference`). Además sobrescribe `intents.bank_reference`, destruyendo la referencia original.
- `src/banking/actions.ts:22-45`: al reenviar el mismo `intentId`, solo se valida usuario y payload — **nunca el `status` del intent**. Un intent `completed` o `failed` se vuelve a despachar.
- `src/banking/client.ts:24-25`: un timeout se convierte en `BankError(504)` sin poder distinguir "el banco lo rechazó" de "el banco lo ejecutó y perdimos la respuesta".

### Reproducción (evidencia before) — CONFIRMADA

Perfil `lost-response`: la primera operación nueva **se compromete en el banco y después devuelve 504**. Script: `scripts/repro-double-debit.ts` (`node --import tsx scripts/repro-double-debit.ts` con servicios arriba).

```text
intent: repro-double-debit-1790609703536
transfer: acc-lucia -> acc-bruno amount €1.00
balance before:              €4007.50

[1st attempt, same intentId] app status: completed
balance after 1st attempt:   €4005.50  (delta -€2.00)

[retry, same intentId]       app status: completed
balance after retry:         €4004.50  (delta -€3.00)

=== VERDICT ===
DOUBLE DEBIT CONFIRMED: one €1.00 intention debited €3.00.
```

**Resultado: una intención de €1,00 debitó €3,00** — TRIPLE débito, por la composición de tres defectos:

1. `dispatch.ts:5-9`: el retry interno ante 504 genera **reference nueva** → el banco (idempotencia `actor+reference`) lo trata como operación distinta → 2º débito. La app devolvió `completed` (la 2ª tentativa sí respondió) aunque el cliente pagó dos veces.
2. `actions.ts:22-45`: el reintento con el mismo `intentId` no comprueba `intents.status` → vuelve a despachar → 3er débito.
3. `intents.bank_reference` se sobrescribe en cada intento → la referencia original (que quedó comprometida en el banco) se pierde para reconciliación.

Nota: la app informó `completed` en ambos casos; el saldo real solo se ve en el banco. El estado reportado no refleja hechos verificados.

### Arreglo (implementado)

**Core: una reference por intent, para siempre.** El banco garantiza que reusar `actor+reference` con payload idéntico devuelve la operación original (`replay:true`) — eso convierte cualquier reintento (interno o de intent) en una consulta segura:

1. `src/banking/dispatch.ts` — nueva función `stableReference(intentId)`: lee `intents.bank_reference`, genera UUID solo si es null y lo persiste una vez. Tanto el retry interno (ambos intentos comparten reference) como el re-despacho entre llamadas lo reutilizan.
2. `src/banking/actions.ts` — gates por estado del intent:
   - `completed` → devuelve el resultado almacenado (enriquecido con la operación real vía `GET /v1/operations/:reference`); nunca re-despacha.
   - `processing` → reconcilia vía `GET /v1/operations/:reference`; nunca re-despacha.
   - `created`/`failed` → procede, siempre con la reference almacenada.
   - Helper compartido `reconcileOutcome`: operación encontrada → `completed` (hecho verificado); 404 → `failed` (ausencia verificada); fallo de la consulta → estado no terminal `processing` con la reference para verificar después. **Nunca reporta `failed` sin evidencia.**
3. `tests/invariants.test.ts` — 4 tests de regresión con un banco fake in-process (sin servicios vivos), escritos test-first (RED observado antes del fix): lost-response debita exactamente una vez; rechazo antes del commit → `failed` verificado; commit inalcanzable → recuperado a `completed`; resultado inverificable → `processing` y el reintento nunca re-despacha.

### Verificación (after) — CONFIRMADA

- `npm run typecheck` ✅ · `npm test` → **17/17** (13 originales + 4 nuevos) ✅
- Repro end-to-end con el mismo script y perfil `lost-response`:

```text
balance before:              €4002.50
[1st attempt, same intentId] app status: completed
balance after 1st attempt:   €4001.50  (delta -€1.00)
[retry, same intentId]       app status: completed
balance after retry:         €4001.50  (delta -€1.00)
=== VERDICT ===
No double debit observed (fixed?).
```

- Transferencia normal bajo perfil `normal`: `completed`, delta exacto de 100 céntimos (sin regresión).

**Before/after**: €1,00 de intención → €3,00 debitados y estados engañosos **antes**; €1,00 debitado exactamente una vez, reintento sin efectos adicionales y estado siempre verificado **después**.

---

## 3. Bug 2: Documentación caducada en las respuestas del asistente

**Fecha**: 28-09-2026 · **Severidad**: alta (evidencia trazable) · **Estado**: RESUELTO · **Rama**: `fix/stale-doc-retrieval`

### El problema

El contrato exige: *"Assistant information should rely on applicable documentation and make its evidence traceable"* y avisa que *"Documents can contain historical versions"*. El corpus incluye 80 documentos con versiones históricas y archivados (`archive-*`, vigentes hasta 2026-08-31), y la fecha de referencia del ejercicio es **2026-09-24** (`src/config.ts:18`).

### Causa raíz (lectura de código)

1. `src/ingestion/chunker.ts:13-16`: `title/version/validFrom/validTo` solo se rellenaban en el chunk de offset 0; el resto quedaban en `null` → la UI mostraba "Version —" y el filtrado por vigencia por chunk era imposible.
2. `src/retrieval/search.ts:18`: solo filtraba por audiencia (`public`/operador). Documentos archivados y sustituidos competían en el ranking con la política vigente → el asistente podía responder con comisiones/reglas caducadas.

### Arreglo (implementado)

1. `chunker.ts`: metadatos del documento propagados a **todos** los chunks. El id del chunk es `sha256(docId:offset:text)` (sin metadatos) → ids estables, el cache de embeddings sigue funcionando (re-ingesta sin coste de API).
2. `search.ts`: filtro de vigencia sobre `referenceDate` con límites inclusivos y `null` = abierto (`validFrom <= ref && (validTo == null || validTo >= ref)`), encima del filtro de audiencia. Formato uniforme `YYYY-MM-DD` en todo el corpus (verificado) → comparación lexicográfica exacta.
3. Re-ingesta + export del índice portable (356 chunks, todos con metadatos completos).

### Verificación (after) — CONFIRMADA

- `npm test` → **19/19** (2 tests nuevos: propagación de metadatos; doc caducado con score 1.0 excluido aunque ganaría el ranking, vector sintético cacheado → cero llamadas de API).
- Búsqueda en vivo `POST /api/search {"query":"Aurora account fees"}` (cliente):

```text
aurora-fees-2026        | v2 2026-09-01 -> None | 0.688
aurora-operations-2026  | v2 2026-09-01 -> None | 0.627
faq-aurora-waiver       | v2 2026-09-01 -> None | 0.621
aurora-conditions-2026  | v2 2026-09-01 -> None | 0.605
aurora-fees-2026        | v2 2026-09-01 -> None | 0.576
```

Cero resultados `archive-*`; todos los chunks con versión y vigencia pobladas (`GET /api/documents/:id/chunks`).

### Nota de diseño

El filtro de vigencia aplica también al rol operador. La biblioteca de documentos (`GET /api/documents`) sigue mostrando TODO el corpus incluidos históricos; solo la *búsqueda que alimenta respuestas* usa exclusivamente documentos vigentes. Si se quisiera que los operadores busquen versiones históricas, sería una decisión de producto aparte.

---

---

## 4. Parte 2 — Trust Layer (feature distintiva)

**Fecha**: 28-09-2026 · **Estado**: IMPLEMENTADA · **Rama**: `feature/trust-layer` (commits `1b1099a` + `53d3333`)

### La idea

Una capa de confianza sobre el asistente que cubre dos contratos incumplidos a la vez:

1. **Confirmation cards**: el agente NUNCA mueve dinero sin revisión explícita — crea una propuesta (monto/origen/destino) que expira en 10 minutos, el cliente la confirma en el panel "Proposals awaiting confirmation", y solo entonces se despacha con garantías exactly-once. Recibo con `reference` verificable vía `operation_status`.
2. **Respuestas con citas verificables**: cada afirmación de política/tarifa/límite lleva cita `[docId vN]` renderizada como chip clicable que abre el documento citado en la biblioteca. Sin evidencia → se admite y se ofrece siguiente paso. Prohibido inventar tarifas o "prácticas bancarias típicas".

### Por qué es distintiva

- No es un chatbot genérico: **cada respuesta es auditable** (cita → documento → versión → vigencia) y **cada operación es reversible-a-la-vista** (propuesta → confirmación → recibo).
- Compone todo lo anterior: docs vigentes (Bug 2), intents exactly-once (Bug 1) y ahora la revisión explícita — la demo encadena los tres.

### Implementación

**Backend (`1b1099a`)** — `src/banking/authorization.ts` + `app/api/[...path]/route.ts`:
- `authorizeTransfer` sin `approvalId` → crea/reusa propuesta pendiente por intent (TTL 10 min) y devuelve `requires_confirmation` **sin despachar**.
- Camino confirm → valida 404/409-consumida/410-expirada/409-payload-alturada y consume **atómicamente** (`UPDATE ... WHERE consumed_at IS NULL` + `changes===1`).
- 5 tests TDD nuevos; los tests exactly-once anteriores actualizados para pasar por la confirmación (garantías intactas). **25/25 tests**.

**Agente + UI (`53d3333`)** — `src/agent/prompt.ts` + `src/agent/run.ts` + `app/page.tsx`:
- Postura evidence-first: fuentes vigentes > conocimiento de fondo; citas obligatorias; sin evidencia → admitirlo + siguiente paso (`request_human` / sección Documents).
- Transferencia `requires_confirmation` → el agente explica que **no** se ejecutó y pide confirmar en el panel.
- Chips de cita accesibles (aria-label) que abren el documento citado.

### Pulido de UX (rama `feature/confirmation-ux`, commit `4236adf`)

**Hallazgo en la primera sesión real de UI**: el flujo funcionaba correctamente (4 propuestas confirmadas y ejecutadas exactamente una vez), pero la propuesta aparecía solo en el panel inferior, fuera de vista, sin indicar su caducidad — la transferencia parecía "colgada". Mejoras aplicadas (solo `app/page.tsx`):

- **Tarjeta inline** bajo el formulario de transferencia (monto, origen→destino con nombres, concepto) con Confirm y Discard, y auto-scroll al aparecer.
- **Cuenta atrás en vivo** (m:ss) en la tarjeta y en cada propuesta del panel.
- **Estado expirado** con botón "Request again" que re-llena el formulario con los mismos datos.
- Outcomes explícitos: éxito limpia la tarjeta; "already confirmed" limpia y refresca; "expired" pasa a modo re-petición.

Esto también es material de video: muestra el ciclo completo **feedback real → diagnóstico con evidencia (DB + logs) → mejora de producto**.

**Segunda iteración (mismo día, commit `0a01b4f`)**: en la prueba real, el usuario confirmó desde el panel y la transferencia se ejecutó, pero **el chat no lo reflejaba** — seguía diciendo "has not been sent", sin recibo y sin forma de confirmar desde la propia conversación. Diagnóstico con evidencia: aprobación `4e31a8bf` consumida + intent `completed` en la DB vs. último mensaje del asistente congelado en el aviso previo. Arreglo:

- La conversación ahora devuelve `pendingApprovals` y el chat muestra **la tarjeta de confirmación dentro de la conversación** (misma cuenta atrás/Confirm/Discard/reintento, un solo estado y un solo intervalo compartidos con el formulario y el panel).
- Al confirmar, el backend añade **un recibo verificado** al hilo: monto, concepto, reference real y etiquetas de cuentas resueltas del banco (fallback a ids; nunca inventado). Nada se añade si el resultado no es `completed`.
- La conversación se recarga sola tras confirmar → el recibo aparece sin refrescar, y el operador lo ve en el historial.

Verificado: 3 tests nuevos (32/32), ciclo en vivo por API (propuesta → `pendingApprovals` → confirm → recibo con reference → segundo confirm 409 sin mensaje extra).

**Tercera iteración (mismo día, commit `e6d1f4c`)**: al probar "Discard", el usuario reportó que la propuesta seguía apareciendo para confirmar, incluso fuera de la conversación. Causa: Discard era cosmético (ocultaba la tarjeta localmente) y la propuesta seguía viva en el servidor — la tabla `approvals` no tenía estado de cancelación. Arreglo:

- Columna `cancelled_at` en `approvals` con **migración idempotente** (`PRAGMA table_info` + `ALTER TABLE` guardado) para bases existentes.
- `POST /api/approvals/:id/cancel`: cancelación atómica (`UPDATE ... WHERE consumed_at IS NULL AND cancelled_at IS NULL`) e idempotente; 409 si ya fue confirmada; 404 para propuestas ajenas.
- Filtros `cancelled_at IS NULL` en dashboard, `pendingApprovals` de la conversación y en el confirm (que ahora responde con mensaje claro y **sin ejecutar nada**).
- UI: Discard llama al endpoint, avisa "Proposal discarded. The transfer was not sent." y refresca panel + conversación.

Verificado en vivo: cancelar → desaparece de ambos lados; re-cancelar idempotente; confirmar la cancelada → 409 sin débito (saldo intacto); 5 tests nuevos (**37/37**).

### Demo script para el video (guión sugerido)

1. **Cita verificable**: "What is the monthly fee of the Aurora account and when is it waived?" → respuesta con chip `[aurora-fees-2026 v2]` → click → abre el documento en la biblioteca. (Verificado: la respuesta cita condiciones exactas — €6/mes, exención con salario ≥€1.200 + 3 compras.)
2. **Sin invención**: "Can I transfer 999 million euros?" → cita el límite documentado en vez de inventarlo (`[aurora-operations-2026 v2]`).
3. **Confirmación explícita**: "Send 1 euro from my Aurora account to Bruno, concept coffee" → el agente muestra la propuesta y aclara que NO se ejecutó → panel "Proposals awaiting confirmation" → Confirm → recibo con reference.
4. **Double-confirm bloqueado**: segundo click en Confirm → 409 "This proposal was already confirmed."
5. **Exactly-once bajo fallo**: con `npm run scenario -- lost-response`, repetir el flujo → exactamente €1 debitado (`scripts/repro-double-debit.ts` imprime "No double debit observed").
6. **Cierre**: saldos consistentes entre UI y banco en todo momento.

---

## 5. Bug 3 (resto) + Bug 4: Visibilidad de operador y telemetría

**Fecha**: 28-09-2026 · **Severidad**: media-alta (resolución de casos) · **Estado**: RESUELTO · **Rama**: `fix/operator-visibility` (commit `691c5b1`)

### El problema

El contrato exige: *"Operators need to understand the conversation, relevant steps, and effects"* y *"Historical evidence that was never recorded must not be invented"*. Pero:

1. `src/operator/view.ts`: `caseDetail` devolvía `history: [], events: [], intents: [], bank: null` hardcodeados — la vista de caso era decorativa.
2. `src/telemetry.ts`: `recordEvent` recibía args/outputs/duración completos y persistía solo `{tool, status}` — la evidencia se descartaba al grabarse.
3. Ninguna ruta mutaba `incidents.status` — **los casos nunca se podían cerrar**.
4. El endpoint del banco para operadores (`GET /v1/operator/customer`) nunca era llamado por la app.

### Arreglo (implementado)

- Telemetría con payload completo (args, outputs, durationMs verbatim).
- `caseDetail` poblado: conversación (últimos 50, orden cronológico), eventos (últimos 100 con payloads parseados), intents (estado/reference/operation_id) y operaciones bancarias reales (actor firmante = operador).
- **Gaps honestos**: sin actividad grabada o fallo del banco se **declara** en `gaps`; JSON malformado se muestra tal cual, nunca se dropea ni se inventa.
- `POST /api/incidents/:id/close` (operador; 404/409) + botón "Resolve case" en la UI.

### Verificación (after) — CONFIRMADA

- `npm test` → **29/29** (4 tests nuevos: telemetría íntegra; caseDetail poblado con aserción de actor operador; banco caído → gaps sin fabricación; cierre 404/403/200/409).
- En vivo: caso creado por Lucía (transferencia €1 + request_human) → Marta ve 2 mensajes, 8 eventos con `arguments/output/durationMs`, 9 operaciones bancarias incluida la de €1,00 con su reference → cierra el caso → segundo cierre → 409.

```text
history: 2 | events: 8 | intents: 1 | bank ops: 9
sample event data keys: ['tool', 'status', 'arguments', 'output', 'durationMs']
bank op: {'amountCents': 100, 'status': 'completed', 'reference': 'ba169fdb-...'}
status: closed
```

### Nota de demo

Este fix cierra el círculo del video: el mismo caso muestra la propuesta de confirmación en la telemetría (`requires_confirmation` con approvalId), la confirmación, la operación exactly-once y el cierre por el operador — todo con evidencia grabada, no narrada.
