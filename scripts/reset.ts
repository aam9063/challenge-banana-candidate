import { seedApp } from '../src/seed';
import { config } from '../src/config';
import { seedBank } from '../simulator/seed';
import fs from 'node:fs';
import path from 'node:path';
const marker = path.join(config.dataDir, 'app-running.pid');
if (fs.existsSync(marker)) {
  const pid = Number(fs.readFileSync(marker, 'utf8'));
  try {
    process.kill(pid, 0);
    console.error('Stop npm run dev/start before resetting the data.');
    process.exit(1);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ESRCH') fs.rmSync(marker, { force: true });
    else throw e;
  }
}
seedBank();
console.log(seedApp());
console.log('Data, conversations, index, and scenarios restored.');
