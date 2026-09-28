# Banana Bank — Work Log (video material)

> Registro cronológico y verificable de todo el trabajo de la Parte 1 y Parte 2.
> Cada entrada es material directo para el video explicativo: problema → evidencia → causa raíz → arreglo → verificación.
> Las sesiones de IA completas están en `submission/ai-sessions/`.

## Índice

1. [Setup y diagnóstico de instalación](#1-setup-y-diagnóstico-de-instalación)
2. [Bug 1: Doble débito en reintentos de transferencia](#2-bug-1-doble-débito-en-reintentos-de-transferencia)

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
