# Session 01 — Setup, installation diagnosis and challenge analysis

- **Date**: 28 September 2026
- **Tool**: pi coding agent (harness), main host session
- **Language**: conversation in Spanish; project in English

## User message (1)

> Vale a ver este es un proyecto para una hackaton. Quiero que vayas a fuego con ella, que te exprimas a más no poder. En la carpeta docs tienes challenge.md y contracts.md ahi tienes en que consiste el proyecto y que es lo que hay que hacer. Pero antes leete el readme e intenta instalar las dependencias porque a mi me da fallos y errores y a ver porque son. El proyecto es en inglés, pero tu me vas a responder en castellano. Creo que hay que adjuntar los archivos de las sesiones de IA para que vean como hemos trabajado con la IA para el desarrollo del proyecto, eso vas a empezar a guardarlo a partir de que tengamos todo el setup listo para poder empezar las implementaciones. Cuando consigas instalar dependencias explicame que es lo que hay que hacer y en que consiste el proyecto

## Work performed (assistant)

1. **Reading of README.md and package.json**: Next.js 16 + React 19 + OpenAI (gpt-6-luna + text-embedding-3-small) + better-sqlite3 project. The README already warns about a known issue on Windows with better-sqlite3 13.0.3.
2. **Reproduction of the failure**: `npm ci` fails on Windows with Node 24.18.0. `node-gyp` error: it finds VS 2022 and VS 2026 Community but "missing any VC++ toolset". Full chain: (a) the better-sqlite3 installer tries `prebuild-install` → 404 for ABI node-v137/win32-x64 on GitHub releases; (b) it falls back to `node-gyp rebuild`; (c) no C++ compiler is installed.
3. **Partial installation**: `npm install --ignore-scripts` installed the 32 top-level packages without trouble (only the native module failed).
4. **Solution applied**: installing the `Microsoft.VisualStudio.Workload.NativeDesktop` workload (Desktop development with C++) on top of the existing VS 2022 Community, via `setup.exe modify --quiet` with UAC elevation approved by the user. Verified afterwards with `vswhere -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64`.
5. **Full installation**: `npm ci` → 0 vulnerabilities, 0 errors. Verified that `better-sqlite3` loads and runs SQL correctly. Note: the package also ships prebuilds embedded in `prebuilds/`, but the install script still invokes node-gyp, hence the original failure.
6. **`npm run setup`**: created `.env.local` (`OPENAI_API_KEY` still to be filled in), seeded databases: 47 conversations, 17 support cases, preloaded embeddings index.
7. **Verification**: `npm run typecheck` OK, `npm test` → 13/13 tests pass.
8. **Reading of docs/challenge.md and docs/contracts.md**: the challenge has 2 mandatory parts (Part 1: audit and fix the app for Monday's launch, 40%; Part 2: distinctive agent feature, 40%; method/verification/handoff cross-cutting, 20%). Deliverable: single ZIP with project + complete AI sessions (this folder) + a 5-10 min video or a PDF.
9. **Code mapping** (exploration subagent): full map of src/agent, src/banking, app/api, src/retrieval, src/operator, src/telemetry and simulator/, with identified weaknesses (see the next assistant message in the session).

## User message (2)

> (Second request, identical to the first, reiterating: read the README, install the dependencies, explain the project, and start saving the AI sessions from the moment the setup is ready.)

## Additional work (assistant)

- Executed the user's choice: launch the C++ toolset installation in the background with UAC.
- Confirmed toolset installation, re-ran `npm ci` with full success.
- Confirmed setup + typecheck + tests 13/13.
- Created `submission/ai-sessions/` with this record.

## Setup closing (continuation of this session)

- The user created `.env` (git-ignored) with the real API key. `npm run doctor` failed at first: `scripts/setup.ts` had created `.env.local` with an empty `OPENAI_API_KEY=`, and `src/config.ts` loads `.env.local` before `.env` (dotenv does not override already-defined variables), so the empty value was masking the real key. Fix: remove the empty line from `.env.local`. Doctor afterwards: green (`gpt-6-luna` responds, embeddings 1536 dims).
- Branch convention defined by the user: features branch out of `dev` (not master) and everything goes through `dev` before `master`. There is an Orca worktree (`C:/Users/alber/orca/workspaces/challenge-banana-candidate/dev-2`, branch `dev-2`) that is not touched from this session.
- `npm run dev` started in the background (log in `.data/dev.log`). Bank on 4001 (`{"ok":true}`) and app on 3000 (HTTP 200).
- README walkthrough verified end-to-end: Lucía sees 2 accounts (Aurora 4.007,50 € + Savings 1.000,00 €), Marta sees 17 support cases, and the chat answered "What accounts do I have?" correctly with both accounts and exact balances.

## State at the close of this entry

Setup 100% operational. Next step: Part 1 — reproduce and prioritize the detected bugs (double debit on retry with `npm run scenario -- intermittent 17`, replay of completed intents, misleading status after timeout, dead approvals flow, expired docs in retrieval, stub operator view, lossy telemetry).
