# Banana Bank — Work Log (video material)

> Registro cronológico y verificable de todo el trabajo de la Parte 1 y Parte 2.
> Cada entrada es material directo para el video explicativo: problema → evidencia → causa raíz → arreglo → verificación.
> Las sesiones de IA completas están en `submission/ai-sessions/`.

## Índice

0. [Mapa contrato → bug → arreglo → evidencia](#0-mapa-contrato--bug--arreglo--evidencia)
0b. [Evidencia del starter: casos sembrados](#0b-evidencia-del-starter-casos-sembrados)
0c. [Medición antes/después (eval)](#0c-medición-antesdespués-eval-de-respuestas)
1. [Setup y diagnóstico de instalación](#1-setup-y-diagnóstico-de-instalación)
2. [Bug 1: Doble débito en reintentos de transferencia](#2-bug-1-doble-débito-en-reintentos-de-transferencia)
3. [Bug 2: Documentación caducada en las respuestas](#3-bug-2-documentación-caducada-en-las-respuestas-del-asistente)
4. [Parte 2: Trust Layer](#4-parte-2--trust-layer-feature-distintiva)
5. [Estado final: hecho / verificado / pendiente](#estado-final-hecho--verificado--pendiente)
6. [Parte 2 (extensión): Coach de comisiones](#6-parte-2-extensión--coach-de-comisiones)

---

## 0. Mapa contrato → bug → arreglo → evidencia

Las cláusulas de negocio de `docs/contracts.md` y el defecto correspondiente en el starter. Cada uno con reproducción, arreglo y verificación.

| Cláusula de `contracts.md` | Bug encontrado | Reproducción / evidencia | Arreglo | Verificación |
|---|---|---|---|---|
| *"An operation intent represents a customer intention. Retrying that intent must not multiply its effects."* | Reference nueva por intento → el dinero se movía **3 veces** | `scripts/repro-double-debit.ts` (perfil `lost-response`): intención de €1,00 → **€3,00** debitados | `8056774`: `stableReference()` por intent + gates de estado + reconciliación | Repro impreso: delta exacto **−€1,00**, reintento sin efectos · 4 tests |
| *"A transport error or timeout does not prove that the bank rejected the operation. Customer-facing status should match verified facts."* | Un 504 marcaba `failed` aunque el banco hubiera commitido | Mismo repro + perfil `slow-response`/`lost-response`; `client.ts` convertía todo timeout en 504 sin verificar | `8056774`: `reconcileOutcome()` (encontrada→completed · 404→failed verificado · consulta falla→`processing` no terminal con reference) | 3 tests (recuperado por reconciliación; inverificable nunca `failed`) |
| *"A sensitive operation must present its amount, source, and destination for explicit review before execution. An informational conversation alone does not authorize payment."* | `authorizeTransfer` devolvía siempre `null`: el flujo de aprobaciones era código muerto y el agente transfería desde el chat | Caso sembrado **Elena** (`fixtures/conversations.json`): *"Before deciding whether to send EUR 25 to Hugo…"* → **"Transfer completed."** | `1b1099a`: propuesta explícita (10 min) + consumo atómico + checks 409/410; `fcd0405`: cancelación real; `221ecf7`: el agente debe crear la propuesta con el tool; `b6b953e`: una propuesta por conversación | 10 tests (propuesta sin débito, doble confirm 409, expirada 410, payload alterado 409, supersede, reutilización) + E2E en vivo |
| *"Assistant information should rely on applicable documentation and make its evidence traceable. Missing evidence should be acknowledged with a useful next step. Documents can contain historical versions."* | Prompt que invitaba a inventar (`concrete estimate`, `references are not required`) + metadatos solo en el primer chunk + sin filtro de vigencia | Casos sembrados **Inés** (*"It is common to receive EUR 30 for a referral"*) y **Carla** (comisión correcta pero **sin cita**); corpus con `archive-aurora-*` (EUR 8) compitiendo con el vigente (EUR 6) | `38fc5ed`: metadatos en todos los chunks + filtro de vigencia (2026-09-24) + re-ingesta; `53d3333`: citas obligatorias `[docId vN]`, prohibido estimar, sin evidencia → admitirlo + siguiente paso | 4 tests de vigencia/cita + búsqueda en vivo sin `archive-*` + preguntas en vivo citando `[aurora-fees-2026 v2]` |
| *"Operators need to understand the conversation, relevant steps, and effects. Historical evidence that was never recorded must not be invented."* | `caseDetail` con `history/events/intents/bank` hardcodeados; `recordEvent` descartaba args/salidas; los casos no se podían cerrar | Código + verificación en vivo: la vista del operador no mostraba nada de lo ocurrido | `691c5b1`: telemetría íntegra, detalle del caso poblado (incl. `GET /v1/operator/customer`), `gaps` honestos, cierre de caso; `c730b02`/`959c4c5`: recibo de confirmación y registro de cancelación en el hilo | 4 tests + E2E con caso real: 8 eventos con `arguments/output/durationMs`, operación con reference, cierre y 409 al repetir |
| *"Only an account holder may initiate a transfer from that account. Operators cannot transfer customer money."* | (Sin defecto encontrado) el check de titularidad existía y el rol se validaba | Revisión de `authorization.ts` / `tools.ts` | Sin cambios | Tests de rol existentes |
| *"Amounts are positive integer euro cents, without overdrafts. Maximum per operation: 10,000,000 cents."* | (Sin defecto encontrado) validación zod activa | Revisión de `transferSchema` | Sin cambios | Tests existentes |

**Lectura para la evaluación**: los cinco defectos materiales del starter se corresponden con cláusulas explícitas del contrato; dos cláusulas (titularidad/roles y límites de importe) ya se cumplían y se verificaron para descartarlas.

---

## 0b. Evidencia del starter: casos sembrados

`fixtures/conversations.json` contiene 47 conversaciones narrativas que **demuestran los bugs dentro del propio starter** — evidencia ideal para el video (el "antes" no lo fabricamos nosotros; viene con el proyecto):

| Cliente | Conversación | Contenido sembrado | Cláusula violada |
|---|---|---|---|
| **Elena** | *Payment planning* | *"Before deciding whether to send EUR 25 to Hugo, what would I need to review?"* → **"Transfer completed."** | Confirmación explícita: una pregunta informativa "ejecutó" un pago |
| **Diego** | *Transfer enquiry* | *"I want to send EUR 200 to Inés"* → *"The operation could not be completed."* | Estado no verificado / sin evidencia |
| **Inés** | *Rewards question* | *"It is common to receive EUR 30 for a referral."* | Alucinación: los documentos **no** especifican referidos (`context-guide-*`) |
| **Carla** | *Account information* | *"The Aurora monthly fee is EUR 6."* (correcto pero **sin cita**) | Evidencia trazable ausente |
| **Lucía** | *Dinner payment* | *"I could not complete the transfer. You can try again."* | Estado no verificado |

Con los arreglos, estos mismos casos cambian de comportamiento: Elena recibe una propuesta a confirmar (no un "completed" falso), Inés escucha que no hay documentación aplicable y se le ofrece un siguiente paso, Carla recibe la comisión **con cita y versión**, y Diego/Lucía obtienen un estado verificado contra el banco.

### Verificación en vivo de los casos sembrados (after)

Preguntados tal cual están sembrados, con el código arreglado:

**Elena** — *"Before deciding whether to send EUR 25 to Hugo, what would I need to review?"*

> Review the source account and available balance, confirm that Hugo is the intended recipient, and check the transfer details before deciding. **I haven't sent anything.**

→ Cero propuestas creadas: una pregunta informativa ya no "ejecuta" nada, y el asistente declara explícitamente que no ha enviado nada (antes respondía "Transfer completed.").

**Inés** — *"How much money do I get for referring a friend to the bank?"*

> I couldn't find applicable documentation stating how much a referral reward pays. You can check the Documents section in the app, or I can open a support case to ask about the current referral offer.

→ Admite la falta de evidencia y ofrece dos siguientes pasos concretos (documentación o caso de soporte); antes inventaba "EUR 30".

---

## 0c. Medición antes/después (eval de respuestas)

Instrumento: `scripts/eval-answers.ts` — 7 preguntas con verdad de referencia del corpus, cada una en una conversación nueva, puntuando tres criterios: **hecho correcto**, **hecho prohibido ausente** (la trampa del archivo) y **cita `[docId vN]`**. `REPEATS=2` → 14 turnos por lado. Evidencia cruda: `submission/evidence/eval-before-r2.json` y `eval-after-r2.json`.

- **BEFORE**: commit base `db0bdf5`, servidor propio en puertos 3010/4011 (worktree desechable, ya eliminado).
- **AFTER**: la rama con los arreglos, servidor en 3000.

| # | Pregunta | Verdad | Trampa | BEFORE | AFTER |
|---|---|---|---|---|---|
| 1 | Comisión Aurora | EUR 6 | EUR 8 (archivado) | 0/2 · sin cita | **2/2 · citado** (`aurora-fees-2026 v2`) |
| 2 | Comisión Horizon | EUR 3 | 6/8 de Aurora | 0/2 · sin cita | **2/2 · citado** (`horizon-fees-2026 v2`) |
| 3 | Recompensa por referidos | no documentado | EUR 30 inventado | 1/2 · sin cita | **2/2** (cita no exigida) |
| 4 | Límite por transferencia | EUR 100.000 | — | 0/2 · sin cita | **2/2 · citado** (`aurora-operations-2026 v2`) |
| 5 | Comisión Cloud | EUR 0 | 2/5/6 | 0/2 · sin cita | **2/2 · citado** |
| 6 | Comisión Community | EUR 2 | 0/5/6 | 0/2 · sin cita | **2/2 · citado** |
| 7 | Comisión Family | EUR 5 | 0/2/6 | 0/2 · sin cita | **2/2 · citado** |
| | **Total** | | | **1/14 pasan · 0/14 citan** | **14/14 pasan · 12/14 citan (12/12 de las exigidas)** |

### Lectura honesta del resultado

- **El delta medido es trazabilidad, no acierto factual.** El código base respondió correctamente los 7 hechos en ambas repeticiones; lo que cambia con el arreglo es el **grounding**: 0/12 turnos citaban antes → 12/12 citan con el `docId` y la versión correctos después. Es exactamente la cláusula *"make its evidence traceable"*.
- **El 1/14 del base no es un fallo del agente base** en su totalidad: 13 turnos fallan por la exigencia de cita (y 1 de ellos por paráfrasis: el base dijo *"couldn't verify a referral reward"* y la regex solo contemplaba *"couldn't find"*). Se registra para no sobreinterpretar el número.
- **Sin invención en ninguna de las 28 respuestas**: ni EUR 8 como comisión vigente, ni recompensa de referidos, ni comisiones cruzadas entre productos.
- **Límites del instrumento (declarados)**: puntúa por presencia/ausencia de cifras, así que una respuesta que *compare* productos (p.ej. "Horizon cuesta EUR 3, no EUR 6 como Aurora") contaría el 6 como prohibido y daría un falso negativo. No ocurrió en ninguna de las 28 respuestas, y el sesgo —de existir— es **en contra** de nuestra medición, nunca a favor.
- **Límite conocido del arreglo**: las preguntas genuinamente históricas no recuperan el valor archivado (los documentos caducados están fuera de la búsqueda que alimenta respuestas; siguen visibles en la biblioteca). Verificado en vivo: *"What was the Aurora account monthly fee before September 2026?"* → el asistente admite que no tiene documentación aplicable, cita el aviso vigente `[notice-aurora v2]` y ofrece consultar el archivo vía soporte — **no inventa el EUR 8**.

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

**Tercera iteración (mismo día, commit `fcd0405`)**: al probar "Discard", el usuario reportó que la propuesta seguía apareciendo para confirmar, incluso fuera de la conversación. Causa: Discard era cosmético (ocultaba la tarjeta localmente) y la propuesta seguía viva en el servidor — la tabla `approvals` no tenía estado de cancelación. Arreglo:

- Columna `cancelled_at` en `approvals` con **migración idempotente** (`PRAGMA table_info` + `ALTER TABLE` guardado) para bases existentes.
- `POST /api/approvals/:id/cancel`: cancelación atómica (`UPDATE ... WHERE consumed_at IS NULL AND cancelled_at IS NULL`) e idempotente; 409 si ya fue confirmada; 404 para propuestas ajenas.
- Filtros `cancelled_at IS NULL` en dashboard, `pendingApprovals` de la conversación y en el confirm (que ahora responde con mensaje claro y **sin ejecutar nada**).
- UI: Discard llama al endpoint, avisa "Proposal discarded. The transfer was not sent." y refresca panel + conversación.

Verificado en vivo: cancelar → desaparece de ambos lados; re-cancelar idempotente; confirmar la cancelada → 409 sin débito (saldo intacto); 5 tests nuevos (**37/37**).

**Cuarta iteración (commit `959c4c5`)**: el descarte debía quedar también registrado en el chat (como el recibo de la confirmación). Se añade un mensaje de cancelación construido solo con el payload almacenado — *"Transfer cancelled: EUR 4.50 from your Aurora account to Bruno Vidal's Horizon account (concept: parent cancel msg) was not sent. No money has moved."* — exactamente una vez por cancelación (sin duplicados en re-cancel), con etiquetas resueltas del banco y fallback a ids. 3 tests nuevos (**40/40**).

**Quinta iteración (commit `221ecf7`)**: el usuario reportó que la tarjeta de confirmación ya no aparecía al pedir una transferencia. Diagnóstico con la tabla `events` (el observable correcto de las tool calls del agente): la conversación mostraba **solo `list_accounts`**, sin ningún evento `transfer_money` ni intents — el modelo respondió en prosa prometiendo una confirmación que nunca creó. Causa: el prompt evidencia-first describía el comportamiento posterior a `requires_confirmation` sin exigir la llamada al tool. Arreglo: reglas imperativas (llamar a `transfer_money` en el mismo turno con datos completos; nunca presentar un resumen en prosa como propuesta; citas solo para documentación). Verificado en vivo con el observable correcto: `list_accounts → transfer_money → requires_confirmation` + propuesta real en la conversación. 40/40 tests.

**Sexta iteración (commit `b6b953e`)**: el usuario vio en el panel propuestas pendientes que no correspondían a su conversación — eran **restos de los smoke tests** del asistente y del worker sobre el mismo usuario (limpiados con la API: 0 pendientes; además se eliminaron 4 conversaciones vacías de prueba). Además se corrigieron dos problemas de producto de fondo:

- **Acumulación de propuestas**: cada turno del agente creaba una propuesta nueva, así que los reintentos se apilaban. Ahora, en una conversación, una petición **idéntica reutiliza** la propuesta existente (mismo `approvalId`) y una **distinta la reemplaza** (la anterior se cancela en silencio, sin mensaje de chat). El UPDATE está acotado por `intents.conversation_id`, así que nunca toca otras conversaciones ni propuestas sin conversación.
- **Panel duplicado**: "Proposals awaiting confirmation" se renderizaba también bajo el chat, compitiendo con la tarjeta inline y mostrando propuestas de otras conversaciones. Ahora vive solo en Overview; en el chat manda la tarjeta.

Verificado en vivo: payload distinto → 1 pendiente y la superseded responde 409; payload idéntico → mismo `approvalId`; conversación y dashboard muestran exactamente una. 4 tests nuevos (**44/44**).

**Lección de método**: no contaminar los datos de demo con smoke tests — limpiar las propuestas al terminar cada verificación.

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

---

## 6. Parte 2 (extensión) — Coach de comisiones

**Fecha**: 29-09-2026 · **Estado**: IMPLEMENTADO · **Rama**: `feature/fee-coach` (commit `17a0b34`)

### La idea

*"¿me van a cobrar comisión este mes?"* — el agente **cruza los movimientos reales del cliente con la política vigente** y responde con la cifra, las condiciones evaluadas una por una y la cita del documento. **La decisión la toma código puro y testeable; el modelo solo la presenta.**

### Por qué es distintiva

Un chatbot genérico puede *explicar* la política de comisiones; este **la evalúa contra el ledger del cliente**. Y compone todo lo construido antes: ledger verificado (exactly-once y reconciliación), documentos filtrados por vigencia, citas trazables y honestidad explícita sobre lo que no se puede saber.

### Cómo decide (sin LLM)

`src/banking/feePolicy.ts`, función pura y sin efectos:

1. **Etiqueta de la cuenta → producto** (`"Aurora account"` → `aurora`).
2. **Documento vigente** desde el índice, con la misma semántica de vigencia que la búsqueda (a la fecha de referencia 2026-09-24); los `archive-*` **nunca** son candidatos.
3. **La comisión se parsea del TEXTO del documento**, no de una tabla hardcodeada: cubre `"The Aurora account monthly fee is EUR 6."` y `"The monthly fee for Horizon is EUR 3."`. Si el texto no la declara → `undetermined`, nunca una cifra inventada.
4. **La regla de exención también sale del texto**: solo Aurora la tiene; los demás documentos la niegan explícitamente. Umbrales parseados: `EUR 1,200` y `three settled card purchases`. Si menciona una exención que no se puede parsear → `undetermined`.
5. **Condiciones contra los movimientos del mes del cliente**: nómina (positivo con `salary`, ≥ umbral) y compras con tarjeta (negativos excluyendo transferencias y saldo inicial), con la evidencia real citada.
6. **`caveats` honestos**: el ledger **no registra estado de liquidación** (los movimientos posteados se tratan como liquidados) y los posteos cerca del límite de mes pueden caer en el mes contiguo.

### Verificación

- **52/52 tests** (8 nuevos): parseo de los cinco documentos vigentes reales (**Aurora 6 · Horizon 3 · Cloud 0 · Community 2 · Family 5**), exención detectada solo en Aurora, matriz de condiciones con ledgers sintéticos (con/sin nómina, 0–4 compras, transferencias excluidas), cuenta de ahorro → `undetermined`, **archivado nunca seleccionado**, caveat de liquidación, exención imparseable → `undetermined`, y la tool end-to-end contra el banco fake.
- **En vivo (modelo real)**:

```text
"Will I be charged a fee for my Aurora account this month?"

For your Aurora account, the fee for September is EUR 0. Both waiver
conditions were met: a salary payment of EUR 1,750 (minimum EUR 1,200)
and four card-like purchases (minimum three) [aurora-fees-2026 v2].

Caveats: Posted movements are treated as settled because the ledger
does not record settlement status. …

"…my Personal savings account…"
Personal savings: Undetermined. No in-force fee policy was found for
this account, so I can't confirm whether you'll be charged. …
```

Nota de precisión: en una primera pasada el modelo adjuntó la cita de Aurora al caveat de la cuenta de ahorro (cita mal atribuida). Se corrigió la guía del prompt — la cita solo puede acompañar a la afirmación que respalda — y se re-verificó: la respuesta de ahorros ya no cita ninguna política.

### Límites declarados

- El parseo tolera el corpus actual, no cualquier redacción futura: ante una reformulación cae en `undetermined` (seguro, aunque silencioso), y hay un test que fija ese comportamiento.
- El mes evaluado deriva de la fecha de referencia (2026-09-24), no del reloj real; un despliegue real debería cambiar la fuente de "ahora".
- `/v1/movements` devuelve hasta 100 movimientos: una cuenta muy activa podría desplazar compras del mes fuera de la ventana.


---

## Estado final: hecho / verificado / pendiente

### Terminado

**Parte 1 (preparación para el lanzamiento)** — 4 familias de defectos corregidas, cada una mapeada a su cláusula en §0:
1. Débito múltiple en reintentos → exactly-once con reference estable, gates de intent y reconciliación de resultados desconocidos.
2. Documentación caducada alimentando respuestas → metadatos por chunk + filtro de vigencia a la fecha de referencia + re-ingesta del índice.
3. Confirmación explícita inexistente → propuestas con caducidad, consumo atómico, cancelación real (Discard), reutilización/supersede y registro del desenlace en la conversación.
4. Operador ciego → telemetría íntegra, detalle de caso con conversación/actividad/operaciones bancarias, "gaps" honestos y cierre de casos.

**Parte 2 (feature distintiva)** — *Trust Layer*: confirmación inline en el chat con cuenta atrás y re-petición + respuestas con citas verificables (documento, versión, vigencia) y conducta sin evidencia. **Extensión**: *Coach de comisiones* — motor de reglas determinista que cruza el ledger del cliente con la política vigente (§6).

### Verificado

- **52 tests** en `npm test` (todos pasan) + `npm run typecheck` limpio.
- **Reproducción reproducible del bug crítico**: `scripts/repro-double-debit.ts` (€1,00 → €3,00 antes; €1,00 exacto después).
- **Eval medido antes/después** (§0c): BEFORE 1/14 pasan · 0/14 citan → AFTER 14/14 pasan · 12/12 de las citas exigidas; 28 respuestas sin ninguna cifra inventada.
- **Casos sembrados del propio starter** (§0b) re-verificados en vivo tras los arreglos.
- **Recorrido funcional completo**: pedir → tarjeta → confirmar (recibo con reference) → descartar (registro) → expirar (re-petición) → auditar en la vista de operador y cerrar el caso.

### Pendiente (declarado)

1. **`intentId` por envío del formulario**: hoy el endpoint genera uno aleatorio por submit; el flujo de propuesta + una-propuesta-por-conversación lo mitiga (no hay doble débito automático), pero un doble clic sin confirmar puede dejar dos propuestas si no hay conversación abierta.
2. **Chunking por secciones y prefijo de producto al embeber**: mejoraría la precisión de recuperación (el boilerplate común a los 80 documentos domina los embeddings). No abordado; el filtro de vigencia y las citas ya evitan el error material.
3. **Recuperación histórica**: los documentos archivados no se recuperan para preguntas genuinamente históricas (limitación declarada en §0c).
4. **Entrega**: grabar el video (guion en §4), mergear la cadena de ramas a `dev` y empaquetar el ZIP (sin `.env*`, `node_modules/`, `.next/`, `.git/`, `.data/`).
5. **Hallazgos menores no abordados** (documentados, no corregidos): el bucle del agente se queda sin señal cuando agota las 7 rondas; `bankRequest` puede lanzar si un 5xx no trae JSON; `/api/people` no requiere sesión.
