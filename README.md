# Banana Bank Technical Challenge

Banana Bank is a fictional bank with an AI assistant. You receive a working application with customer history and room for improvement. The challenge has two parts: assess and improve readiness for a Monday launch, then design and implement a useful, differentiating improvement to the agent or its agentic workflow. Read the [challenge brief](docs/challenge.md) ([PDF](docs/challenge.pdf)), investigate the product, and submit demonstrable improvements in a ZIP containing the complete project.

## Before you start

Read the challenge brief and **preserve your AI sessions from your first interaction**. Verify that you can export or retain the complete conversation in your chosen tool before starting work; see [AI session exports](#ai-session-exports). Download or clone the starter using the access arrangements in your invitation. A fork is optional; the deliverable is a ZIP.

## Quick start

Requirements: **Node.js 24 or newer** (Node 24 LTS recommended), npm, and one OpenAI project key with access to `gpt-6-luna` and `text-embedding-3-small`. The `.nvmrc` selects the recommended Node 24 major; it is not an upper version limit. No Docker, GPU, or database service is required. SQLite stores data locally. Node 24.4.1 and 26.10.0 have been tested on macOS arm64; Windows and Linux use the same commands but have not been validated on those platforms.

```sh
npm ci
npm run setup
```

`setup` creates `.env.local` from the example and initializes empty databases. Edit it:

```dotenv
OPENAI_API_KEY=your_project_key
OPENAI_CHAT_MODEL=gpt-6-luna
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
```

You can also supply `OPENAI_API_KEY` as an environment variable. Environment variables take priority over `.env.local`, which takes priority over `.env`. One key serves both APIs. It is used only on the server; never commit it or place it in a parent-directory file.

```sh
npm run doctor
npm run dev
```

Open **http://127.0.0.1:3000**. This starts both the web application and bank API (port 4001); Ctrl+C stops both. `doctor` makes a small real model request and embedding request, consuming API quota. Accounts, manual transfers, documents, and support cases can be explored without a key; chat and semantic search require one. The supplied index contains real embeddings, so startup does not regenerate them.

## First-run check

This short walkthrough confirms that the environment is usable; it does not certify that the application meets the business requirements.

1. Run `npm run doctor` with your key configured. It should print a model reply and an embedding dimension count of 1536. A failure here concerns configuration, permissions, quota or connectivity; use the troubleshooting section below.
2. Run `npm run dev`, wait for the web service to be ready, then open http://127.0.0.1:3000. The first page may take longer to compile in development.
3. Select Lucía. Her overview should show two accounts. Open the document library and verify that documents load.
4. Open a new chat and ask `What accounts do I have?`. The assistant should respond. A turn can take tens of seconds and may make several model calls; the `Checking…` indicator does not by itself mean the request is stuck. Inspect a reported error or the terminal if it does not finish. Assess the correctness of its behavior as part of the challenge.
5. Select Marta. With fresh seed data, the operator view should list 17 support cases, including nine open and eight resolved cases.

If a service cannot start, or the model connection fails, report the command, error and Node/npm versions to the organizers without including credentials. Account, transfer or assistant behavior discovered after successful setup is part of your investigation; passing this walkthrough does not resolve it.

## Explore

Switch between eight fictional customers and two operators using the selector. Lucía has two accounts, Bruno can receive a transfer and see it in his activity, and Diego has a small balance. Marta and Pablo handle support cases. The selector is a test convenience, not production authentication. Customer data and conversations remain separated by the selected context.

The seed contains 12 accounts, 47 conversations, and 17 support cases. The bank is authoritative for balances, movements, and operations. A separate application database stores conversations, runs, proposals, support cases, and the document index. Initial conversations are narrative fixtures; new operations traverse the actual application code and simulator.

**Work on the web application, agent and their integration with the bank.** The service in `simulator/` represents an external bank, not another application you are asked to improve. Its supported failure scenarios are part of the environment the application must handle. Disabling those scenarios or changing the bank's behavior does not demonstrate an application fix. Evaluation can replace it with an independent bank implementing the same [contract](docs/contracts.md).

Fresh setup and reset select the reproducible `intermittent` profile with seed `17`. While the bank is running, `npm run scenario -- normal` lets you establish a normal-response baseline; `npm run scenario -- intermittent 17` restores the initial profile. Switching profiles resets the scenario counter, not balances. Use the supported scenarios to investigate the application's behavior.

The document library contains **80 synthetic Markdown, HTML, and CSV documents**: policies, fees, FAQs, procedures, and historical versions. The exercise's document reference date is **24 September 2026**, independent of the date you run it. The entire ingestion pipeline is editable in this repository.

Existing installations: stop the services and run `npm run reset` to load the updated history. This deletes local activity and restores the supplied index; `setup` preserves an existing database. Save any evidence you need first.

## Commands

| Command | Effect |
|---|---|
| `npm run setup` | Creates missing configuration; seeds empty databases only |
| `npm run dev` | Starts both services in development mode |
| `npm run reset` | With services stopped, restores both databases and the supplied index; deletes local activity |
| `npm run ingest` | Reprocesses documents and replaces the index, reusing identical cached embeddings |
| `npm run ingest -- --export` | Also updates the portable index included in the repository |
| `npm run scenario -- normal` | Configures the running bank with normal responses |
| `npm run scenario -- intermittent 17` | Activates a reproducible sequence of transport incidents |
| `npm run scenario -- lost-response` | The next new operation receives an error after its effects are committed |
| `npm run typecheck` / `npm test` | Checks types and public invariants |
| `npm run build` | Creates the production build; run this before `npm start` |
| `npm start` | Starts both services using an existing production build |

For production mode, stop development services, run `npm run build`, then run `npm start`. Rebuild after changing application code. Development mode does not require a production build.

Additional scenarios and contracts are in [contracts.md](docs/contracts.md). After changing ingestion code, run `npm run ingest`. After a reset, ingest again to restore your modified index. Changing embedding models requires regenerating the index.

## Project map

```text
app/                   Next.js web interface and API
src/agent/             Responses loop, instructions, and tools
src/banking/           Integration, actions, and authorization
src/ingestion/         Corpus loading and chunking
src/retrieval/         Embeddings, cache, and SQLite index
src/operator/          Support case view
src/telemetry.ts        Activity recording
simulator/             External-bank simulator and ledger (test dependency)
fixtures/              Documents and initial index
scripts/               Startup, seed, reset, and utilities
submission/            Your supporting submission materials
```

You may change the application and its organization. Preserve the observable contract or supply an equivalent adapter: evaluation can connect your application to another bank instance. MCP is not required; tools are server functions calling the bank API.

## AI session exports

Save the complete challenge conversations from your chosen tools and put the original exports in `submission/ai-sessions/` or an optional `submission/ai-sessions.zip`. Include those files in the single delivery ZIP together with the complete project code for both parts and your video or alternative explanation. Use a native export or the relevant saved session files; you can ask your assistant to help collect and package them. Check that the exported files contain the full conversations, not a summary. Choose the format that works for you.

## Configuration and troubleshooting

Optional settings are in `.env.example`. To move the bank port, update both `BANK_PORT` and `BANK_URL`. `DATA_DIR` and `BANK_DATA_DIR` can separate storage; both default to `.data/`. For separate startup, use `npm run bank` in one terminal and `npx next dev --webpack --hostname 127.0.0.1 --port 3000` in another; both must share `BANK_SERVICE_SECRET`.

**Configuration precedence**: `config.ts` loads `.env.local` first and then `.env`, and a variable that is already set is never overwritten. That means an **empty** `OPENAI_API_KEY=` in `.env.local` shadows a real key coming from `.env` or from the process environment, producing a confusing connection error. Put the key in exactly one place; `npm run setup` leaves the line commented out so any source works.

OpenAI 401 usually means an invalid key; 403/model errors can mean missing project access; 429 indicates quota or rate limits. `doctor` isolates these checks from the UI. Search also needs a key: a missing key returns an explicit `OPENAI_API_KEY` configuration message. After changing `.env.local`, restart the services. Ensure ports 3000/4001 are free. `reset` refuses to clear data if it detects running challenge services. Services bind to localhost and never move real money.

On Windows, `better-sqlite3` 13.0.3 has a [reported installation issue](https://github.com/WiseLibs/better-sqlite3/issues/1516): `npm ci` may invoke `node-gyp` and fail when Python or C++ build tools are unavailable, including on Node 24. If this blocks setup, send the organizers the error and your Node/npm versions; an installation blocker is not part of the challenge.

`next-env.d.ts` and `.next/` are generated by Next.js and ignored by Git. `npm run typecheck` generates the required declarations before checking types, so it also works before your first development run.

The starter contains behavior worth investigating. Passing public tests does not mean it is ready for customers. Add checks that support your improvements. The invitation specifies the deadline, time budget, access arrangements, and submission channel.
