# Guion del video — Banana Bank (5–10 min)

> **Idioma**: el video va en castellano. El documento escrito de entrega (`EXPLANATION.md`) está en inglés porque lo lee el evaluador.
> **Antes de grabar**: `npm run dev` (los dos servicios) y tener a mano dos pestañas: la app y una terminal.
> **Regla de oro**: el video explica *decisiones*, no lee código. Mostrá pantalla, hablá tranquilo, y cuando digas un número, que se vea.

---

## 0:00 — 0:45 · Apertura

**Decir:**

> "Hola, este es mi trabajo para el challenge de Banana Bank. Es un banco ficticio con un asistente de IA. Hice dos cosas: primera, encontrar y arreglar los problemas que impedirían lanzar el lunes; segunda, construir una capacidad distintiva para el agente. Todo lo que voy a mostrar está respaldado con evidencia reproducible: scripts que imprimen el antes y el después, 52 tests automáticos y una medición con números."

**Mostrar**: la app en `http://127.0.0.1:3000` con el selector de clientes.

---

## 0:45 — 2:30 · Parte 1: el bug crítico (el momento más fuerte)

**Acción previa (antes de grabar, en la terminal):**

```sh
npm run scenario -- lost-response
```

**Decir:**

> "El banco simulado tiene perfiles de fallo documentados. Voy a usar `lost-response`: la operación se ejecuta en el banco y después se pierde la respuesta. Es el escenario más peligroso para una app de pagos, porque no podés distinguir 'no se hizo' de 'se hizo y no me enteré'."

**Acción (en la terminal):**

```sh
node --import tsx scripts/repro-double-debit.ts
```

**Decir mientras corre:**

> "Esta es la reproducción del bug. Una sola intención de un euro. En la versión original, esa intención terminaba debitando **tres euros**." *(mostrar el veredicto)*

**Si querés mostrar el "antes"** (opcional, muy potente): bajá temporalmente al commit inicial con `git stash`/otra rama y mostrá `DOUBLE DEBIT CONFIRMED: one €1.00 intention debited €3.00`. Si no, bastará con señalar el número en el texto.

**Decir la causa:**

> "Tres defectos que se combinaban: cada reintento generaba una **referencia nueva** para el banco, así que el banco lo tomaba como una operación distinta; el reintento de la misma intención **no miraba el estado** de la operación anterior; y la referencia original se sobrescribía, así que era imposible reconciliar. El arreglo es una **referencia estable por intención** más puertas de estado: una intención completada devuelve su resultado, una en proceso se reconcilia y nunca se reenvía. Y si el resultado es desconocido, la app **no inventa**: consulta al banco y, si no puede verificar, queda como 'pendiente de verificación' — nunca dice 'falló' sin evidencia."

**Mostrar el después** (ya está en pantalla): `No double debit observed`, delta exacto −€1,00.

---

## 2:30 — 3:30 · La evidencia que trae el propio starter

**Acción**: abrir `fixtures/conversations.json` (o la vista de operador con esos casos) y luego la app.

**Decir:**

> "Esto no lo inventé yo: el proyecto original trae conversaciones sembradas que demuestran los bugs. Mirá esta."

**Mostrar Elena:**

> Cliente: *"Before deciding whether to send EUR 25 to Hugo, what would I need to review?"* → Asistente: **"Transfer completed."**

**Decir:**

> "Una pregunta informativa 'ejecutó' una transferencia. Eso viola directamente el contrato, que dice que una conversación informativa no autoriza un pago."

**Acción**: en la app, entrar como Elena y escribir: *"Before deciding whether to send EUR 25 to Hugo, what would I need to review?"*

**Leer la respuesta nueva:**

> *"... I haven't sent anything."*

**Decir:**

> "Ahora explica qué revisar y aclara que no envió nada. Cero propuestas creadas."

**Y la segunda (más rápida)**: entrar como Inés y preguntar *"How much money do I get for referring a friend to the bank?"* → *"I couldn't find applicable documentation... You can check the Documents section, or I can open a support case."*

> "Antes inventaba 'EUR 30 por referido'. La documentación no especifica referidos: ahora lo admite y ofrece un camino concreto."

---

## 3:30 — 4:45 · Trust Layer: nada se mueve sin confirmación explícita

**Acción** (Lucía): *"Send 1 euro from my Aurora account to Bruno"*

**Decir:**

> "El agente no transfiere: **propone**. Fijate que aparece la tarjeta acá mismo, en la conversación, con el monto, la cuenta de origen y el destino, y una cuenta atrás."

**Mostrar**: la tarjeta con `Expires in 9:xx`, `Confirm these details`, `Discard`.

**Decir:**

> "La propuesta caduca en 10 minutos. El consumo es atómico, así que **no se puede confirmar dos veces**. Y si descarto, se cancela de verdad."

**Acción**: click en **Discard** → aparece el mensaje en el chat: *"Transfer cancelled: EUR 1.00 ... was not sent. No money has moved."*

**Decir:**

> "Descartar no esconde la tarjeta: **cancela la propuesta en el servidor** y deja registro en la conversación. Y si alguien intenta confirmarla después, recibe un error claro y **no se mueve dinero**."

**Acción**: pedir de nuevo el envío y esta vez **Confirm** → aparece el recibo:

> *"Transfer completed: EUR 1.00 from your Aurora account to Bruno Vidal's Horizon account ... Reference: ..."*

**Decir:**

> "El recibo se construye solo con hechos verificados: monto, cuentas y la referencia real del banco. Nada inventado."

---

## 4:45 — 5:45 · Citas verificables: cada afirmación es auditable

**Acción** (Lucía): *"What is the monthly fee of my Aurora account?"*

**Mostrar**: la respuesta con el chip `aurora-fees-2026 v2`.

**Decir:**

> "Cada afirmación de política viene con la cita del documento **y su versión**. El chip es clickeable y abre el documento citado. Antes el prompt le decía literalmente al modelo que rellenara los huecos con 'prácticas bancarias comunes' y que las referencias no hacían falta. Ahora es al revés: sin evidencia, no se afirma."

**Acción**: *"What was the Aurora fee before September 2026?"*

**Decir:**

> "Pregunta histórica: el asistente **admite que no tiene documentación aplicable** para el valor anterior, cita el aviso vigente y ofrece consultar el archivo por soporte. No inventa el importe viejo."

---

## 5:45 — 6:45 · La capacidad distintiva: coach de comisiones

**Acción** (Lucía): *"Will I be charged a fee for my Aurora account this month?"*

**Mostrar** la respuesta: comisión, condiciones ✓ con evidencia real (nómina de €1.750, 4 compras, 22 transferencias excluidas) y la cita.

**Decir:**

> "Acá está lo más distintivo: el agente **cruza los movimientos reales del cliente con la política vigente**. Y la decisión no la toma el modelo: la toma código determinista y testeable."

**Acción**: abrir `src/banking/feePolicy.ts` y señalar 10 segundos (sin leer en voz alta):

> "Este archivo hace cinco cosas: identifica el producto por la cuenta, busca el documento **vigente** —los archivados quedan fuera por diseño—, **parsea la comisión del texto del documento** (no hay ninguna tabla hardcodeada), **parsea la regla de exención del mismo texto**, y la evalúa contra tus movimientos del mes. Si el texto no lo dice, el resultado es 'indeterminado' en lugar de una cifra inventada."

**Acción**: *"…my Personal savings account…"* → *"Undetermined. No in-force fee policy was found…"*

> "Cero invención, y **sin robar** la cita de otro producto. Ese detalle lo corregí yo: en la primera versión el modelo adjuntaba la cita de Aurora al caveat de la cuenta de ahorro. Una cita mal atribuida es peor que ninguna."

---

## 6:45 — 7:45 · Operador + medición

**Acción**: cambiar a **Marta** → abrir un caso.

**Decir:**

> "El operador antes veía una pantalla vacía: todo estaba codificado en duro. Ahora ve la conversación completa, la actividad del agente con argumentos, salidas y duraciones, las intenciones con su referencia del banco y las operaciones confirmadas. Y cuando algo **no se registró**, lo dice: no inventa. Además puede cerrar el caso."

**Acción**: mostrar el caso con datos y cerrarlo.

**Mostrar** (opcional, 20 segundos) `submission/evidence/eval-before-r2.json` y `eval-after-r2.json`.

**Decir:**

> "Medí el impacto con un eval de 7 preguntas con trampa de valor prohibido. Antes: 1 de 14 turnos pasaban y **cero** citaban. Después: 14 de 14 pasan y **12 de 12** de las citas exigidas. Y quiero ser honesto con la lectura: **el modelo base ya acertaba los hechos**; lo que cambió es la trazabilidad — que ahora cada afirmación se puede auditar. El instrumento tiene un sesgo declarado y lo dejé documentado."

---

## 7:45 — 8:30 · Método, límites y cierre

**Decir:**

> "Sobre el método: cada arreglo empezó con **reproducción antes del arreglo**, los cambios críticos se escribieron con **tests primero** —hay 52 tests— y cada unidad se documentó con su evidencia. Hay un registro cronológico completo y las sesiones de IA originales en la carpeta de submission."

> "Y también digo lo que **no** está resuelto: la recuperación histórica no trae el valor archivado, sino que admite el hueco; el parseo de comisiones tolera el corpus actual, no cualquier redacción futura; y el chunking de documentos todavía es de tamaño fijo. Están listados en el documento de entrega con su impacto."

**Cierre:**

> "En resumen: la aplicación pasó de poder debitar tres veces una intención de un euro a debitarla exactamente una vez con estado verificado; pasó de inventar datos a citar documentos; y el asistente ahora **decide con código, confirma con el cliente y audita con evidencia**. Gracias."

---

## Checklist antes de subir el video

- [ ] El video muestra: repro del doble débito, tarjeta de confirmación, recibo con referencia, chip de cita, fee coach, vista de operador
- [ ] Se escucha claro el antes/después del dinero (€3,00 → €1,00) y la lectura honesta del eval
- [ ] Se menciona al menos un límite conocido
- [ ] Duración entre 5 y 10 minutos
- [ ] Al terminar: `npm run scenario -- intermittent 17` para dejar el entorno en el perfil por defecto
