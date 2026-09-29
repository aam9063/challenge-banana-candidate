# Feature: Part 2 (extensión) — Coach de comisiones (Fee coach)

Branch: `feature/fee-coach` (desde `dev`).

## Objetivo

Responder *"¿me van a cobrar comisión este mes?"* cruzando **los movimientos reales del cliente** con la **política vigente del producto**, con **reglas deterministas en código** (el LLM no calcula: solo presenta). Cada afirmación sale con la cita del documento y la versión; lo que no se puede verificar se declara.

## Por qué es distintiva

- Un chatbot genérico puede *explicar* la política; este **la evalúa contra el ledger del cliente**.
- La decisión la toma código puro y testeable, no el modelo: demostrable leyendo `src/banking/feePolicy.ts`.
- Compone toda la Parte 1: ledger verificado (exactly-once/reconciliación), documentos vigentes por fecha (no archivados), citas trazables y honestidad sobre lo que no se sabe.

## Contrato de datos verificado (no asumido)

| Dato | Realidad en el simulador |
|---|---|
Cuentas | `GET /v1/accounts` → `label` ('Aurora account', 'Personal savings', …) → mapeable a producto |
Movimientos | `GET /v1/movements` → `amountCents`, `description`, `createdAt` — **sin campo de tipo ni de liquidación** |
Nómina sembrada | `'September salary'` **+175.000 c** (€1.750) |
Compras | 4 débitos (~€10–20) `Groceries`, `Internet bill`, `Coffee shop`, `Transport` |
Comisión por producto | Aurora 6 · Horizon 3 · Cloud 0 · Community 2 · Family 5 (`{producto}-fees-2026`, v2) |
Exención | Solo Aurora (`waived` + `salary` + 3 compras con tarjeta en el mismo mes) |
Archivados | `archive-aurora-*` = EUR 8 → **trampa**: nunca debe usarse para el mes actual |

## Tareas

- [x] 1. `src/banking/feePolicy.ts`: motor puro. Lee el documento **vigente** del producto desde el índice, extrae la comisión y la regla de exención **del texto del documento** (no de una tabla hardcodeada); evalúa las condiciones contra los movimientos del mes; devuelve resultado estructurado + `caveats`.
- [x] 2. Tool `fee_status` en `src/agent/tools.ts` (cuentas + movimientos del cliente desde la API del banco) devolviendo el resultado estructurado.
- [x] 3. Guía en `src/agent/prompt.ts`: ante preguntas de comisiones, usar la tool y presentar hechos + condiciones + cita; nunca calcular ni estimar por su cuenta; declarar los caveats.
- [x] 4. Tests (puros, sin servicios): parseo de comisión y detección de exención sobre los 5 documentos reales; evaluación de condiciones con ledgers sintéticos (con/sin nómina, 0/1/2/3/4 compras); producto sin política (ahorros) → indeterminado; el archivado nunca se selecciona; tool-level con banco fake.
- [x] 5. Verificación en vivo con el modelo real (Lucía Aurora + otro producto) y línea de demo para el video.
- [ ] 6. Commit de work-unit + `work-log.md` §6 + `session-02` Fase 12.

## Decisiones de diseño

- **La comisión sale del documento, no del código**: si el texto no la declara, el motor responde "no puedo determinarlo" (nunca inventa). Un test fija los 5 valores reales.
- **"Liquidada"**: el ledger no registra estado de liquidación → se tratan los movimientos posteados como liquidados, y eso se declara explícitamente en `caveats`.
- **Mes evaluado**: mes calendario actual (UTC) del ledger.
- **Producto sin política de comisión** (p. ej. cuenta de ahorro): resultado `undetermined` con explicación, sin inventar.
- **Vigencia**: se consulta el índice ya filtrado por fecha de referencia (2026-09-24), así los archivados quedan fuera por diseño.

## Resultado esperado (forma)

```jsonc
{
  "status": "decided",            // o "undetermined"
  "month": "2026-09",
  "policy": { "documentId": "aurora-fees-2026", "version": 2, "validFrom": "2026-09-01", "validTo": null },
  "accounts": [
    { "accountId": "acc-lucia", "product": "aurora", "feeCents": 0,
      "conditions": [ { "name": "salary>=1200", "met": true, "evidence": "…" },
                      { "name": "settled card purchases>=3", "met": true, "evidence": "4 …" } ] }
  ],
  "caveats": ["Posted movements are treated as settled; the ledger does not record settlement status."]
}
```
