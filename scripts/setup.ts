import fs from 'node:fs';
import { seedApp } from '../src/seed';
import { seedBank } from '../simulator/seed';
import { config } from '../src/config';
import { appDb } from '../src/db';
import { bankDb } from '../simulator/db';
if (!fs.existsSync('.env.local')) {
  // Copy the example but leave OPENAI_API_KEY commented out. config.ts loads
  // .env.local before .env and dotenv never overwrites an already-set variable,
  // so an EMPTY key here would shadow a key provided through .env or the
  // process environment and produce a confusing connection error.
  const example = fs.readFileSync('.env.example', 'utf8');
  const local = example.replace(/^(OPENAI_API_KEY=)\s*$/m, '# $1');
  fs.writeFileSync('.env.local', local);
  console.log(
    'Created .env.local: set OPENAI_API_KEY there, or leave it commented and export it.',
  );
}
if (!appDb().prepare('SELECT value FROM meta WHERE key=?').get('seed')) console.log(seedApp());
if (!(bankDb().prepare('SELECT COUNT(*) n FROM accounts').get() as { n: number }).n) seedBank();
console.log(`Ready. Data in ${config.dataDir}. Run npm run dev.`);
