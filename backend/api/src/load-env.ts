import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

const apiRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(apiRoot, '../../..');

for (const envPath of [path.join(repoRoot, '.env'), path.join(apiRoot, '.env')]) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: true });
  }
}
