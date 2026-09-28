# Sesión 02 — Implementación: Parte 1 (4 bugs), Parte 2 (Trust Layer) y pulido UX

- **Fecha**: 28 de septiembre de 2026
- **Herramienta**: pi coding agent (harness), sesión del host principal + subagentes (exploración, workers de implementación)
- **Idioma**: conversación en castellano; artefactos de código en inglés

> **Nota de método**: este archivo se mantiene de forma continua durante la sesión. Recoge los mensajes del usuario y el trabajo del asistente: decisiones, comandos, evidencia y resultados. Las sesiones 01 y 02 corresponden a la misma sesión de trabajo del harness, divididas por hito (setup / implementación) para que sean legibles.

---

## Mensajes del usuario en esta sesión

1. "Vale a ver este es un proyecto para una hackaton. Quiero que vayas a fuego con ella... En la carpeta docs tienes challenge.md y contracts.md... antes leete el readme e intenta instalar las dependencias porque a mi me da fallos y errores y a ver porque son... Creo que hay que adjuntar los archivos de las sesiones de IA... eso vas a empezar a guardarlo a partir de que tengamos todo el setup listo... Cuando consigas instalar dependencias explicame que es lo que hay que hacer y en que consiste el proyecto" *(repetido dos veces)*
2. "voy a crear el .env que no estara trackeado por git y ahi irá la api key, te aviso ahora"
3. "ya está. Una cosa que se me ha olvidado decirte, todas las features saldran a ramas a partir de dev no de master. Todo pasara por dev antes de master"
4. "Sí. Quiero que lo documentes todo cuando lo implementes. A parte de las sesiones de IA quiero otro md para registrar todo para hacer el video explicativo y documentarlo bien"
5. "lo de los docs caducados depende de esta rama de fix? si no es asi continia en otra rama,si depende hazlo en la misma ya que no puedo mergear ahora mismo"
6. "vamos con la c pues" *(elegir la Parte 2 — feature distintiva — tras presentar opciones)*
7. "sigue con el bug 4"
8. "de momento se queda asi. Cuando me ponga delante del pc comprobaré todo y a ver si podmeos mejorar algo y seguramemente mejoraremos la UI (aunque no la he visto todavia)"
9. "pi update --extensions"
10. "Mira los logs ya que esta todo el rato la transferencia pendiente de confirmacion [+captura]"
11. "Si, y que funcione todo de manera fluida"
12. "he confirmado pero sigue ese mensaje, no sale ninguno de confirmacion [+2 capturas]"
13. "ya he bajado la terminal, ya puedes levantarlo tu para tener logs"
14. "la de confirmar esta clara. Pero la de Discard no. Mira [+captura] al yo darle a Discard me sigue apareciendo para confirmar y encima fuera de la conversaciób"
15. "por cierto no estas generando las sesiones de ia como has hecho con la del setup inicial y eso"

---

## Fase 0 — Cierre del setup (puente con la Sesión 01)

- Diagnóstico y arreglo del fallo de instalación (toolset C++ de Visual Studio) y del `.env.local` vacío que tapaba la API key.
- `npm run doctor` en verde; walkthrough del README verificado por API: Lucía con 2 cuentas, Marta con 17 casos, chat respondiendo con saldos exactos.
- Convención de ramas registrada (features salen de `dev`; todo pasa por `dev` antes de `master`) y guardada en memoria del proyecto.

---

## Fase 1 — Bug 1: doble débito en reintentos de transferencia

**Rama**: `fix/transfer-idempotency` (desde `dev`).

**Exploración**: mapeo completo del código por un subagente de exploración (8 debilidades priorizadas); lectura directa de `src/banking/{dispatch,actions,client,authorization}.ts`, `src/agent/tools.ts`, `src/retrieval/*`, `src/operator/view.ts`, `src/telemetry.ts`.

**Reproducción (determinista)**: script `scripts/repro-double-debit.ts` con el perfil `lost-response` del banco simulado (la operación se compromete y después se pierde la respuesta).

**Resultado before — peor de lo previsto**:

```text
transfer: acc-lucia -> acc-bruno amount €1.00
balance before:              €4007.50
[1st attempt, same intentId] app status: completed
balance after 1st attempt:   €4005.50  (delta -€2.00)
[retry, same intentId]       app status: completed
balance after retry:         €4004.50  (delta -€3.00)
=== VERDICT ===
DOUBLE DEBIT CONFIRMED: one €1.00 intention debited €3.00.
```

**Causa raíz (3 defectos compuestos)**:
1. `dispatch.ts`: cada intento generaba `randomUUID()` nuevo → el retry interno ante 504 cobraba otra vez (2º débito).
2. `actions.ts`: al reintentar el mismo `intentId` solo se validaba usuario/payload, nunca el `status` → 3er débito.
3. `intents.bank_reference` se sobrescribía → la referencia comprometida se perdía para reconciliación.

**Arreglo (delegado a worker con spec cerrada, TDD)**:
- `stableReference(intentId)`: una reference por intent, persistida una vez, reutilizada en todo intento (el banco entonces hace replay).
- Gates de estado del intent: `completed` → resultado almacenado; `processing` → reconciliación, nunca re-despacho.
- `reconcileOutcome()`: tras 5xx consulta `GET /v1/operations/:reference` → encontrada = `completed` (hecho verificado); 404 = `failed` (ausencia verificada); fallo de consulta = `processing` no terminal. **Nunca `failed` sin evidencia.**

**Verificación after**: `npm test` 17/17 (4 tests nuevos RED→GREEN con banco fake in-process); typecheck OK; repro impreso como "No double debit observed" con delta exacto −€1,00 y reintento sin efectos.

**Commits**: `404847c` (scaffolding + repro), `8056774` (fix), `ab28c45` (docs).

---

## Fase 2 — Bug 2: documentación caducada en las respuestas

**Rama**: `fix/stale-doc-retrieval` (apilada sobre la anterior: comparten `submission/work-log.md` y `odd/`, así que ramificar de `dev` habría garantizado conflictos; el usuario no podía mergear en ese momento).

**Causa raíz**: `chunker.ts` solo ponía `title/version/validFrom/validTo` en el chunk de offset 0 (el resto `null` → sin filtrado posible y UI "Version —"); `search.ts` filtraba solo por audiencia → políticas archivadas (`archive-*`, vigentes hasta 2026-08-31) competían con la política vigente a la fecha de referencia (2026-09-24).

**Arreglo**: metadatos propagados a todos los chunks (ids `sha256(docId:offset:text)` sin metadatos → cache de embeddings intacto, re-ingesta sin coste); filtro de vigencia inclusivo con `null` = abierto; re-ingesta + export del índice portable (356 chunks).

**Verificación**: `npm test` 19/19 (2 nuevos); búsqueda en vivo "Aurora account fees" → solo documentos v2 vigentes, cero `archive-*`; chunks con metadatos completos.

**Commits**: `38fc5ed` (fix), `075bcc6` (docs).

---

## Fase 3 — Parte 2: Trust Layer (feature distintiva)

**Decisión de producto**: se presentaron 4 opciones al usuario (Trust Layer completa / solo confirmaciones / solo citas / copiloto de operador) con previews; **el usuario eligió la Trust Layer completa**. Rama `feature/trust-layer` (apilada).

### Tarea 1 — Flujo de aprobaciones (arregla de paso el Bug 3)

**Hallazgo**: la infraestructura existía completa pero desconectada — tabla `approvals` con `expires_at`/`consumed_at`, endpoint `confirm`, panel en la UI y estado `requires_confirmation` manejado; `authorizeTransfer` siempre devolvía `null` (código muerto).

**Implementación**: propuestas de 10 minutos creadas/reusadas por intent; camino confirm con validaciones 404/409-consumida/410-expirada/409-payload-alterado y **consumo atómico** (`UPDATE ... WHERE consumed_at IS NULL` + `changes===1`); checks tempranos en el endpoint confirm.

**Verificación**: `npm test` 24/24 (5 tests TDD nuevos); E2E en vivo: propuesta → panel → confirm → completada con un único débito de €1,00 → segundo confirm 409.

### Tarea 2 — Citas verificables (evidencia trazable)

**Hallazgo**: el prompt invitaba a inventar ("common banking practices", "concrete estimates", "references are not required") — postura inaceptable para un banco.

**Implementación**: instrucciones evidence-first (fuentes vigentes > conocimiento de fondo; cita obligatoria `[docId vN]` en toda afirmación de política/tarifa/límite; prohibido estimar; sin evidencia → admitirlo + siguiente paso concreto); guía para presentar `requires_confirmation` como propuesta no ejecutada; chips de cita clicables en el chat; test de invariante del prompt.

**Verificación**: `npm test` 25/25; en vivo: pregunta de comisiones respondida con `[aurora-fees-2026 v2]`; límite documentado citado en vez de inventado; petición de transferencia respondida con propuesta sin afirmar ejecución.

**Commits**: `1b1099a` (aprobaciones), `53d3333` (citas), `f91c202` (docs + guión de video de 6 pasos), `607cfcf`/`92fc624` (tracking).

---

## Fase 4 — Bug 4: visibilidad de operador y telemetría

**Rama**: `fix/operator-visibility` (apilada).

**Causa raíz**: `caseDetail` devolvía `history/events/intents` vacíos y `bank: null` hardcodeados; `recordEvent` descartaba args/outputs/duración guardando solo `{tool,status}`; ninguna ruta cerraba casos; el endpoint de operador del banco nunca se usaba.

**Arreglo**: telemetría con payload íntegro; `caseDetail` poblado (conversación, eventos, intents, operaciones bancarias del cliente con el operador como actor firmante); `gaps` honestos cuando falta evidencia o el banco no responde (nunca fabricar); `POST /api/incidents/:id/close` + botón "Resolve case".

**Verificación**: `npm test` 29/29 (4 nuevos); en vivo: caso creado por Lucía → Marta ve 2 mensajes, 8 eventos con `arguments/output/durationMs`, la operación de €1,00 con su reference, cierra el caso y el segundo cierre da 409.

**Commits**: `691c5b1` (feat), `cfa6bd4` (docs).

---

## Fase 5 — Pulido UX de confirmación (feedback real del usuario)

**Contexto**: el usuario probó la UI real y reportó "está todo el rato la transferencia pendiente de confirmación". Diagnóstico con evidencia (DB + logs): las 4 propuestas anteriores se confirmaron y ejecutaron correctamente; la última simplemente esperaba confirmación, y el panel quedaba fuera de vista sin indicar caducidad.

**Implementación** (`feature/confirmation-ux`): tarjeta inline bajo el formulario con nombres humanos, auto-scroll, cuenta atrás m:ss, estado expirado con "Request again" que re-llena el formulario, outcomes explícitos (éxito/already-confirmed/expired), cuenta atrás también en el panel.

**Verificación**: typecheck + 29/29 + smoke E2E por API.

**Commits**: `4236adf` (feat), `003a915` (docs).

---

## Fase 6 — Cerrar el círculo en la conversación

**Contexto**: nueva prueba real del usuario: confirmó desde el panel, la transferencia se ejecutó (verificado en DB: aprobación consumida + intent completed), pero **el chat seguía diciendo "has not been sent"** y no había recibo ni forma de confirmar desde el chat.

**Implementación**:
- `GET /api/conversations/:id` devuelve `pendingApprovals` de esa conversación.
- Al confirmar, el backend añade **un** mensaje de recibo al hilo, construido solo con hechos verificados (monto, concepto, reference del banco + etiquetas de cuentas resueltas del banco, con fallback a ids; nada se añade si el resultado no es `completed`).
- El chat muestra la tarjeta de confirmación dentro de la conversación (mismo estado e intervalo compartidos) y recarga el hilo tras confirmar.

**Verificación propia (asistente)**: ciclo completo por API — propuesta → `pendingApprovals` en la conversación → confirm `completed` (reference `b229adea…`) → último mensaje del asistente: *"Transfer completed: EUR 2.50 from your Aurora account to Bruno Vidal's Horizon account (concept: parent check). Reference: b229adea-…"* → segundo confirm 409 con **un solo** mensaje en el hilo. `npm test` 32/32.

**Commits**: `c730b02` (feat), `8d2dc1a` (docs).

---

## Fase 7 — "Discard" cancela de verdad (completada)

**Contexto**: el usuario reportó que al pulsar Discard la propuesta seguía apareciendo para confirmar, además fuera de la conversación.

**Causa raíz**: `Discard` era cosmético (ocultaba la tarjeta localmente); la propuesta seguía viva en el servidor, y la tabla `approvals` no tenía estado de cancelación (solo `expires_at`/`consumed_at`), ni `src/db.ts` tenía migraciones.

**Implementación delegada**: columna `cancelled_at` con migración idempotente (`PRAGMA table_info` + `ALTER TABLE`); endpoint `POST /api/approvals/:id/cancel` con cancelación atómica e idempotente (409 si ya fue confirmada); filtros `cancelled_at IS NULL` en dashboard, `pendingApprovals` y confirm; gate en `authorizeTransfer`; UI que cancela, avisa ("Proposal discarded. The transfer was not sent.") y refresca; tests de cancelación (desaparece de ambos lados, confirm posterior sin POST al banco, doble cancel idempotente, cancelación ajena 404).

---

## Decisiones transversales y su porqué

| Decisión | Porqué |
|---|---|
Stackear ramas en vez de ramificar siempre de `dev` | Los archivos de submission (`work-log.md`, `ai-sessions/`, `odd/`) son compartidos y el usuario no podía mergear; apilar evita conflictos garantizados |
Todo el trabajo va por subagentes con specs cerradas y superficies de edición permitidas | Delegación obligatoria del harness; además permite revisar diffs pequeños por unidad de trabajo |
Un commit de work-unit por cambio de comportamiento, con tests y docs en el mismo commit | Revisabilidad y trazabilidad para la evaluación |
Evidencia before/after con scripts reproducibles | El challenge valora "comprobaciones reproducibles before/after" |
`gaps` honestos y nunca inventar | Contrato explícito del challenge |
Arreglar los bugs que la infraestructura dormida insinuaba (aprobaciones, operador, telemetría) | El starter construye infraestructura desconectada a propósito: conectarla es exactamente el trabajo esperado |

## Pendientes al cierre de esta entrada

1. ~~Verificar y commitear la Fase 7 (cancelación real del Discard)~~ — hecho: `npm test` 37/37, cancelación verificada en vivo (desaparece de chat+dashboard, confirm posterior 409 sin débito), commit `fcd0405`.
2. Revisar la UI completa con el usuario y aplicar mejoras de layout si hacen falta.
3. Grabar el video (guión de 6 pasos en `submission/work-log.md` §4).
4. Mergear la cadena de ramas a `dev` en orden y empaquetar el ZIP de entrega.
