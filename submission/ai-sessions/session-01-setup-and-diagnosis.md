# Sesión 01 — Setup, diagnóstico de instalación y análisis del challenge

- **Fecha**: 28 de septiembre de 2026
- **Herramienta**: pi coding agent (harness), sesión del host principal
- **Idioma**: conversación en castellano; proyecto en inglés

## Mensaje del usuario (1)

> Vale a ver este es un proyecto para una hackaton. Quiero que vayas a fuego con ella, que te exprimas a más no poder. En la carpeta docs tienes challenge.md y contracts.md ahi tienes en que consiste el proyecto y que es lo que hay que hacer. Pero antes leete el readme e intenta instalar las dependencias porque a mi me da fallos y errores y a ver porque son. El proyecto es en inglés, pero tu me vas a responder en castellano. Creo que hay que adjuntar los archivos de las sesiones de IA para que vean como hemos trabajado con la IA para el desarrollo del proyecto, eso vas a empezar a guardarlo a partir de que tengamos todo el setup listo para poder empezar las implementaciones. Cuando consigas instalar dependencias explicame que es lo que hay que hacer y en que consiste el proyecto

## Trabajo realizado (asistente)

1. **Lectura del README.md y package.json**: proyecto Next.js 16 + React 19 + OpenAI (gpt-6-luna + text-embedding-3-small) + better-sqlite3. El README ya advierte un issue conocido en Windows con better-sqlite3 13.0.3.
2. **Reproducción del fallo**: `npm ci` falla en Windows con Node 24.18.0. Error de `node-gyp`: encuentra VS 2022 y VS 2026 Community pero "missing any VC++ toolset". Cadena completa: (a) el instalador de better-sqlite3 intenta `prebuild-install` → 404 para ABI node-v137/win32-x64 en GitHub releases; (b) cae a `node-gyp rebuild`; (c) no hay compilador de C++ instalado.
3. **Instalación parcial**: `npm install --ignore-scripts` instaló los 32 paquetes superiores sin problemas (solo fallaba el módulo nativo).
4. **Solución aplicada**: instalación del workload `Microsoft.VisualStudio.Workload.NativeDesktop` (Desktop development with C++) sobre el VS 2022 Community existente, vía `setup.exe modify --quiet` con elevación UAC aprobada por el usuario. Verificado después con `vswhere -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64`.
5. **Instalación completa**: `npm ci` → 0 vulnerabilidades, 0 errores. Verificado que `better-sqlite3` carga y ejecuta SQL correctamente. Nota: el paquete también incluye prebuilds embebidos en `prebuilds/`, pero el script de instalación sigue invocando node-gyp, de ahí el fallo original.
6. **`npm run setup`**: creado `.env.local` (pendiente de completar `OPENAI_API_KEY`), bases de datos sembradas: 47 conversaciones, 17 casos de soporte, índice de embeddings precargado.
7. **Verificación**: `npm run typecheck` OK, `npm test` → 13/13 tests pasan.
8. **Lectura de docs/challenge.md y docs/contracts.md**: el challenge tiene 2 partes obligatorias (Parte 1: auditar y arreglar la app para el lanzamiento del lunes, 40%; Parte 2: feature distintiva del agente, 40%; método/verificación/handoff transversal, 20%). Entregable: ZIP único con proyecto + sesiones de IA completas (esta carpeta) + video de 5-10 min o PDF.
9. **Mapeo del código** (subagente de exploración): mapa completo de src/agent, src/banking, app/api, src/retrieval, src/operator, src/telemetry y simulator/, con debilidades identificadas (ver siguiente mensaje del asistente en la sesión).

## Mensaje del usuario (2)

> (Segunda petición, idéntica a la primera, reiterando: leer README, instalar dependencias, explicar el proyecto, y empezar a guardar las sesiones de IA desde que el setup esté listo.)

## Trabajo adicional (asistente)

- Ejecutó la elección del usuario: lanzar en segundo plano la instalación del toolset de C++ con UAC.
- Confirmó instalación del toolset, relanzó `npm ci` con éxito completo.
- Confirmó setup + typecheck + tests 13/13.
- Creó `submission/ai-sessions/` con este registro.

## Cierre del setup (continuación de esta sesión)

- El usuario creó `.env` (git-ignorado) con la API key real. `npm run doctor` falló inicialmente: `scripts/setup.ts` había creado `.env.local` con `OPENAI_API_KEY=` vacío, y `src/config.ts` carga `.env.local` antes que `.env` (dotenv no pisa variables ya definidas), por lo que el valor vacío tapaba la key real. Fix: eliminar la línea vacía de `.env.local`. Doctor posterior: verde (`gpt-6-luna` responde, embeddings 1536 dims).
- Convención de ramas definida por el usuario: las features salen de `dev` (no de master) y todo pasa por `dev` antes que `master`. Existe un worktree de Orca (`C:/Users/alber/orca/workspaces/challenge-banana-candidate/dev-2`, rama `dev-2`) que no se toca desde esta sesión.
- `npm run dev` arrancado en segundo plano (log en `.data/dev.log`). Banco en 4001 (`{"ok":true}`) y app en 3000 (HTTP 200).
- Walkthrough del README verificado end-to-end: Lucía ve 2 cuentas (Aurora 4.007,50 € + Ahorros 1.000,00 €), Marta ve 17 casos de soporte, y el chat respondió correctamente a "What accounts do I have?" con ambas cuentas y saldos exactos.

## Estado al cierre de esta entrada

Setup 100% operativo. Siguiente paso: Parte 1 — reproducir y priorizar los bugs detectados (doble débito en reintento con `npm run scenario -- intermittent 17`, replay de intents completadas, estado engañoso tras timeout, flujo de aprobaciones muerto, docs caducados en recuperación, vista de operador stub, telemetría lossy).
