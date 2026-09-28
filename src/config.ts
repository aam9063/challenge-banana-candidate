import dotenv from 'dotenv';
import path from 'node:path';
dotenv.config({ path: '.env.local', quiet: true });
dotenv.config({ path: '.env', quiet: true });
export const config = {
  dataDir: path.resolve(process.env.DATA_DIR || '.data'),
  bankDataDir: path.resolve(process.env.BANK_DATA_DIR || process.env.DATA_DIR || '.data'),
  bankUrl: process.env.BANK_URL || 'http://127.0.0.1:4001',
  bankPort: Number(process.env.BANK_PORT || 4001),
  appPort: Number(process.env.APP_PORT || 3000),
  serviceSecret: process.env.BANK_SERVICE_SECRET || 'banana-local-service',
  adminSecret: process.env.BANK_ADMIN_SECRET || 'banana-local-admin',
  sessionSecret: process.env.SESSION_SECRET || 'banana-local-session',
  chatModel: process.env.OPENAI_CHAT_MODEL || 'gpt-6-luna',
  embeddingModel: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
  bankTimeoutMs: Number(process.env.BANK_TIMEOUT_MS || 1400),
};
export const referenceDate = '2026-09-24';
