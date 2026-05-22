// Load .env before any module reads process.env (e.g. llm.ts).
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

const workerRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(workerRoot, '../../..');

for (const envPath of [
  path.join(repoRoot, '.env'),
  path.join(workerRoot, '.env'),
]) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: true });
  }
}
