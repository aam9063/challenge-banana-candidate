# Sesión 03 — Pendientes declarados, Coach de comisiones y calidad de recuperación

- **Fecha**: 29 de septiembre de 2026
- **Herramienta**: pi coding agent (harness), sesión del host principal + subagentes (workers de implementación)
- **Idioma**: conversación en castellano; artefactos de código en inglés

> **Nota de método**: a partir de esta sesión, cada **sesión de trabajo** tiene su propio archivo (antes, el trabajo de varios días se agrupaba en un solo archivo por fases). `session-02` cubre el 28-09 (fases 0–11); este archivo cubre el 29-09.

---

## Mensajes del usuario en esta sesión

1. "Vamos a continuar por donde lo dejamos."
2. "levanta el proyecto para que compruebe el estado"
3. "No, si no has terminado, termina"
4. "Está todo correcto"
5. "como que los comandos exactos?" *(aclaración: el ZIP lo descarga del repositorio; pide además un documento para PDF)*
6. "El zip lo descargo yo de github y ya viene sin los node modules ni el .env ni nada. Y lo del pdf tambien lo quiero. Arma un buen md explicando todo (a parte del video que voy a hacer) y lo convierto a pdf y lo incluyo"
7. *(reporte de estado del repositorio y pedido de completar los pendientes declarados: `intentId` por envío del formulario, chunking por secciones y prefijo de producto al embeber, recuperación histórica, y los hallazgos menores — señal al agotar las 7 rondas del agente, `bankRequest` con respuesta no-JSON, `/api/people` sin sesión)*

---

## Fase 1 — Coach de comisiones: motor determinista sobre el ledger

**Decisión de diseño**: se eligió el **coach de comisiones** como extensión de la Parte 2 por ser la propuesta más distintiva y por combinar ledger + RAG + honestidad, con la decisión tomada por **código puro y testeable** en lugar del modelo.

**Trabajo**: `src/banking/feePolicy.ts` (motor puro: producto desde la etiqueta de la cuenta, documento vigente del índice con los `archive-*` excluidos, comisión y regla de exención **parseadas del texto del documento**, condiciones evaluadas contra los movimientos del mes, caveats honestos sobre la ausencia de estado de liquidación en el ledger), tool `fee_status` (identidad del servidor), guía de prompt (el modelo presenta, nunca calcula) y 8 tests nuevos.

**Verificación**: 52/52 tests, incluido el parseo de los cinco documentos reales (Aurora 6 · Horizon 3 · Cloud 0 · Community 2 · Family 5) y que el archivado (EUR 8) nunca se selecciona; en vivo con el modelo real, Lucía obtiene **EUR 0** con ambas condiciones cumplidas y cita `[aurora-fees-2026 v2]`, y su cuenta de ahorro da `undetermined` sin cifra inventada.

**Corrección detectada en revisión del padre**: en la primera pasada el modelo adjuntó la cita de Aurora al caveat de la cuenta sin política (cita mal atribuida). Se endureció la guía (la cita solo acompaña a la afirmación que respalda) y se re-verificó: la respuesta de ahorros ya no cita política alguna.

**Límites declarados**: parseo tolerante al corpus actual (ante reformulaciones cae en `undetermined`, con test que lo fija), mes evaluado derivado de la fecha de referencia y ventana de 100 movimientos de `/v1/movements`.

## Fase 2 — Endurecimiento de la configuración de entorno

**Contexto**: el fallo que bloqueó el proyecto el primer día (el `OPENAI_API_KEY=` **vacío** que `setup.ts` escribía en `.env.local`, que tapaba la key real de `.env` porque `config.ts` carga `.env.local` primero y dotenv no pisa variables ya definidas) se había diagnosticado y resuelto en la máquina, pero **no estaba corregido en el código**. Cualquier persona que clonara la entrega y configurara la key por la vía natural (`.env` o variable de entorno) habría chocado con el mismo error confuso en su primer `npm run doctor`.

**Trabajo** (rama `fix/env-precedence`, desde `dev`): `scripts/setup.ts` ahora escribe `.env.local` a partir del ejemplo con la línea `OPENAI_API_KEY` **comentada**, de modo que la key puede venir de `.env.local`, de `.env` o del entorno sin que un valor vacío la tape; y `README.md` documenta la regla de precedencia y la trampa.

**Verificación**: se borró `.env.local`, se ejecutó `npm run setup` y se comprobó que el archivo generado contiene `# OPENAI_API_KEY=`; el `.env.local` original se restauró **byte-idéntico** (verificado con `diff`). `npm run typecheck` y `npm test` (44/44 en esa rama) en verde.

**Nota de método**: se eligió una rama propia desde `dev` en vez de colarlo en la rama del fee coach, para no mezclar un arreglo de entorno con una feature de producto.

## Fase 3 — Documentación de entrega

**Contexto**: el brief pide explicar el trabajo y listar los materiales incluidos, y el usuario además quiere un documento para convertir a PDF e incluir en la entrega.

**Trabajo**:
- `submission/EXPLANATION.md` (276 líneas, en inglés por ser el idioma del evaluador): resumen y scorecard, quick start con la trampa de precedencia de `.env`, cada familia de defectos mapeada a su cláusula de `contracts.md` con causa raíz, commit del arreglo y evidencia antes/después, la evidencia sembrada del propio starter, la Trust Layer y el Coach de comisiones, el método de trabajo, una tabla *afirmación → cómo reproducirla*, la medición con su lectura honesta y el sesgo del instrumento, los límites declarados, una demo guiada de 5 minutos y el mapa de ramas/commits/archivos.
- `submission/README.md`: inventario de entrega con rutas relativas de todo lo incluido, archivos del proyecto que llevan el trabajo, exclusiones y lo que falta (el video).
- `submission/VIDEO-SCRIPT.md`: guion de grabación en castellano, con tiempos, comandos exactos, prompts a escribir y salidas esperadas; incluye el checklist previo a subir el video.

**Decisión de idioma**: la documentación que lee el evaluador (`EXPLANATION.md`, `README.md`) va en inglés; el guion del video va en castellano porque es lo que se dice en cámara.

**Pendiente al escribir esta fase**: los pendientes declarados de la sesión (ver Fase 4 y 5).

## Fase 4 — Cierre de pendientes declarados (bloque 1)

**Alcance** (rama `fix/form-intent-and-minors`, desde `master`):

1. **`intentId` por envío del formulario**: el formulario de transferencia mantiene la identidad de su envío (misma firma de payload → mismo `intentId`) y la envía al endpoint; en el servidor, el camino sin conversación reutiliza una propuesta pendiente idéntica del mismo usuario. Resultado: un doble clic no crea dos propuestas.
2. **Señal al agotar las rondas del agente**: cuando el bucle termina con llamadas de herramienta pendientes, se registra un evento de telemetría y la respuesta final explica que no se pudo completar el pedido y ofrece un siguiente paso concreto.
3. **`bankRequest` con respuesta no-JSON**: se parsea de forma defensiva y se lanza un `BankError` con el estado real y un mensaje claro en lugar de un `SyntaxError` suelto.
4. **`/api/people` sin sesión**: se mantiene público (el selector de personas debe funcionar antes de que exista sesión; es una comodidad del simulador local, no autenticación), pero ahora está **documentado en el código** y **fijado por un test**, para que sea una decisión explícita y no una omisión.

**Verificación**: pendiente de cierre en esta misma sesión.

## Fase 5 — Calidad de recuperación y recuperación histórica

**Alcance previsto** (rama propia desde `master`):

1. **Chunking por secciones**: dividir por encabezados `##` en lugar de ventanas fijas de 650 caracteres, con subdivisión cuando una sección es demasiado larga.
2. **Prefijo de producto al embeber**: embeber `título · documentId · versión` junto al texto, sin ensuciar el texto que se muestra y cita (el boilerplate común a los 80 documentos hoy domina los embeddings).
3. **Recuperación histórica**: clasificador determinista de intención histórica en la consulta que habilita incluir documentos vencidos, marcados como históricos y con la instrucción de declararlos como tales (hoy quedan fuera por completo).

**Verificación prevista**: tests de chunking y de clasificación, búsqueda con y sin intención histórica, re-ingesta con `--export`, y **re-ejecución del eval** (`REPEATS=2`) para medir el efecto sobre precisión y citas.

## Pendientes al cierre de esta sesión

1. Cerrar la Fase 4 (verificación en vivo) y la Fase 5.
2. Grabar el video siguiendo `VIDEO-SCRIPT.md`.
3. Empaquetar el ZIP de entrega (descarga desde el repositorio) con el PDF y el video dentro de `submission/`.

