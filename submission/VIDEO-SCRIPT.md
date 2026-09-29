# Video Script — Banana Bank (target: 4 minutes)

> Deliverable asks for 5–10 minutes; this script is a tight **4:00** take that keeps every strong beat. If you want to reach 5:00, hold each screen 15 seconds longer — do not add slides.
> Screen-only recording is fine. Two tabs: the app (`http://127.0.0.1:3000`) and a terminal.
> **Language versions below**: record in either one — the beats, timings and prompts are identical.
> Before recording: `npm run dev`, then `npm run scenario -- lost-response`. After recording: `npm run scenario -- intermittent 17`.

---

## ESPAÑOL (versión para grabar)

### 0:00 — 0:15 · Gancho (sin introducción, de una)

**Decir** *(mirando el número en pantalla)*:

> "Un euro. Tres euros. Eso es lo que cobraba el asistente de este banco por una sola intención de transferencia."

**Acción**: el resultado de `scripts/repro-double-debit.ts` con `DOUBLE DEBIT CONFIRMED: one €1.00 intention debited €3.00` en pantalla.

---

### 0:15 — 1:00 · El bug, la causa y el arreglo

**Decir**:

> "El banco simulado ejecuta y después pierde la respuesta. Tres defectos se combinaban: cada reintento generaba una **referencia nueva**, así que el banco lo leía como otra operación; el reintento no miraba el **estado** de la intención; y la referencia original se borraba, así que era imposible reconciliar."

**Acción** (una línea en la terminal):

```sh
node --import tsx scripts/repro-double-debit.ts
```

**Decir mientras corre**:

> "Misma intención, mismo escenario: **un euro, una sola vez**. Y si el resultado es desconocido, la app consulta al banco; si no puede verificar, queda *pendiente de verificación*. Nunca dice 'falló' sin evidencia."

**Mostrar**: `No double debit observed`.

---

### 1:00 — 1:25 · El starter delata sus propios bugs

**Acción**: mostrar `fixtures/conversations.json` (caso Elena) y luego la app como Elena.

**Decir**:

> "Esto no lo inventé yo: el proyecto original trae conversaciones sembradas con los bugs adentro. Elena pregunta qué debería revisar antes de enviar 25 euros, y el asistente responde... **'Transfer completed'**. Una pregunta ejecutó un pago."

**Acción**: preguntar lo mismo en vivo: *"Before deciding whether to send EUR 25 to Hugo, what would I need to review?"*

**Leer**:

> "... I haven't sent anything."

> "Cero propuestas creadas. Eso ya es el contrato cumplido."

---

### 1:25 — 2:25 · Trust Layer: la tarjeta y la cita

**Acción** (Lucía): *"Send 1 euro from my Aurora account to Bruno"*

**Decir**:

> "El agente no transfiere: **propone**. Tarjeta en la conversación, monto, origen, destino y cuenta atrás. Caduca en diez minutos, el consumo es atómico —no se puede confirmar dos veces—, y si descarto, **se cancela de verdad**."

**Acción**: `Discard` → leer el mensaje: *"Transfer cancelled: EUR 1.00 ... was not sent. No money has moved."*

> "Y queda registrado en la conversación. Esto no oculta nada."

**Acción**: pedir otra vez y **Confirm** → mostrar el recibo con `Reference:`.

> "Recibo construido solo con hechos verificados: monto, cuentas y la referencia real del banco."

**Acción**: *"What is the monthly fee of my Aurora account?"* → click en el chip `aurora-fees-2026 v2`.

**Decir**:

> "Cada afirmación de política viene con el documento **y su versión**, clicable. Antes el prompt pedía rellenar huecos con 'prácticas bancarias comunes'. Ahora, sin evidencia, no se afirma."

---

### 2:25 — 3:05 · Lo distintivo: el coach de comisiones

**Acción** (Lucía): *"Will I be charged a fee for my Aurora account this month?"*

**Decir**:

> "Acá está la parte que más me gusta: el asistente **cruza tus movimientos reales con la política vigente** y responde la comisión del mes — con las condiciones evaluadas una por una y su evidencia: la nómina de 1.750 euros, las cuatro compras, y las veintidós transferencias excluidas del conteo."

**Acción**: abrir `src/banking/feePolicy.ts` cinco segundos.

**Decir**:

> "Y la decisión **no la toma el modelo**: la toma este código. Busca el documento vigente —los archivados quedan fuera—, **parsea la comisión del texto**, parsea la regla de exención del mismo texto, y la evalúa contra tu ledger."

**Acción**: *"…my Personal savings account…"* → *"Undetermined…"*

> "Cuenta sin política: **indeterminado**, cero invención. Y sin robar la cita de otro producto — ese detalle lo corregí yo en revisión."

---

### 3:05 — 3:40 · El operador y la medición

**Acción**: entrar como **Marta**, abrir un caso (mostrar actividad del agente + operación bancaria), cerrarlo.

**Decir**:

> "El operador antes veía una pantalla vacía. Ahora ve la conversación, lo que hizo el agente con argumentos y salidas, y las operaciones confirmadas por el banco. Y cuando algo **no se registró, lo dice**: no inventa."

**Acción**: mostrar los dos JSON del eval, lado a lado.

**Decir**:

> "Medí el impacto: antes, 1 de 14 respuestas pasaban y **cero** citaban. Después, 14 de 14 y **12 de 12** de las citas exigidas. Y la lectura honesta: **el modelo base ya acertaba los hechos**; lo que cambió es que ahora cada afirmación se puede **auditar**."

---

### 3:40 — 4:00 · Cierre

**Decir**:

> "También digo lo que falta: la recuperación histórica admite el hueco en vez de traer el valor archivado, y el parseo tolera el corpus actual, no cualquier redacción futura. Está todo documentado con su impacto."

> "En una frase: **el modelo conversa, el código decide, y el banco puede probarlo.**"

---

## ENGLISH (recording version)

### 0:00 — 0:15 · Hook

**Say**:

> "One euro. Three euros. That is what this bank's assistant charged for a single transfer intention."

**Action**: show the script output with `DOUBLE DEBIT CONFIRMED: one €1.00 intention debited €3.00`.

### 0:15 — 1:00 · The bug, the cause, the fix

**Say**:

> "The simulated bank commits the operation and then loses the response. Three defects compounded: every retry minted a **fresh reference**, so the bank read it as a different operation; the retry never looked at the intention's **status**; and the original reference was overwritten, so reconciliation was impossible."

**Action**: `node --import tsx scripts/repro-double-debit.ts`

**Say**:

> "Same intention, same failure profile: **one euro, exactly once**. And when the outcome is unknown, the app asks the bank; if it cannot verify, the state stays *pending verification*. It never reports 'failed' without evidence."

### 1:00 — 1:25 · The starter exposes its own bugs

**Say**:

> "I did not invent this: the original project ships seeded conversations with the bugs inside. Elena asks what she should review before sending 25 euros and the assistant answers... **'Transfer completed'**. A question executed a payment."

**Action**: ask it live → read: "... I haven't sent anything." → "Zero proposals created."

### 1:25 — 2:25 · Trust Layer: the card and the citation

**Say**:

> "The agent does not transfer: it **proposes**. A card in the conversation with amount, source, destination and a countdown. It expires in ten minutes, consumption is atomic — you cannot confirm twice — and if I discard it, it is **really cancelled**."

**Action**: `Discard` → read the cancellation message. Then propose again, `Confirm`, show the receipt `Reference:`. Then ask the Aurora fee question and click the `aurora-fees-2026 v2` chip.

**Say**:

> "Every policy statement carries the document **and its version**, clickable. The original prompt told the model to fill gaps with 'common banking practices'. Now, without evidence, it does not assert."

### 2:25 — 3:05 · The distinctive part: the fee coach

**Say**:

> "This is my favourite part: the assistant **crosses your real movements with the in-force policy** and answers this month's fee — each condition evaluated with its evidence: the 1,750-euro salary, the four card purchases, and the twenty-two transfers excluded from the count."

**Action**: show `src/banking/feePolicy.ts` for five seconds.

**Say**:

> "And the decision is **not the model's**: it is this code. It finds the in-force document — archived ones are excluded — **parses the fee from the text**, parses the waiver rule from the same text, and evaluates it against your ledger."

**Action**: ask about the savings account → "Undetermined…" → "No policy for that product: **undetermined**, zero invention, and it does not borrow another product's citation — I fixed that in review."

### 3:05 — 3:40 · Operator and measurement

**Action**: switch to the operator, open a case, show agent activity and the bank operation, close it.

**Say**:

> "The operator used to see an empty screen. Now they see the conversation, what the agent did with arguments and outputs, and the operations the bank confirmed. And when something **was not recorded, it says so** — it does not invent."

**Action**: show both eval JSON files side by side.

**Say**:

> "I measured the impact: before, 1 of 14 answers passed and **zero** carried a citation. After, 14 of 14 and **12 of 12** of the required citations. And the honest reading: **the base model already got the facts right**; what changed is that every claim can now be **audited**."

### 3:40 — 4:00 · Close

**Say**:

> "I also say what is missing: historical retrieval acknowledges the gap instead of returning the archived figure, and fee parsing tolerates the current corpus rather than any future wording. All documented with its impact."

> "In one sentence: **the model talks, the code decides, and the bank can prove it.**"

---

## Pre-upload checklist

- [ ] Show: the €3 → €1 reproduction, the confirmation card, the receipt reference, the citation chip, the fee coach, the operator case
- [ ] Say out loud the honest reading of the evaluation (traceability, not factuality)
- [ ] Mention at least one remaining limitation
- [ ] 4–5 minutes total; no slides, screen only
- [ ] Restore the default profile afterwards: `npm run scenario -- intermittent 17`
