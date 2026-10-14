import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { readdir, stat, unlink } from 'node:fs/promises';
import { loadConfig } from './config.js';
import { connectDatabase, disconnectDatabase } from './db.js';
import { Blob } from './models.js';

const envFile = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);
const config = loadConfig();
const apply = process.argv.includes('--apply');
if (apply && !process.argv.includes('--server-stopped')) throw new Error('Stop every API instance first, then pass --apply --server-stopped. Cleanup must not run during uploads.');
const cutoff = Date.now() - 24 * 60 * 60 * 1000;
try {
  await connectDatabase(config.mongoUri);
  const directory = path.join(config.storageDir, 'blobs');
  const keys = await readdir(directory).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error));
  let count = 0;
  for (const key of keys) {
    if (!/^[a-f0-9-]{36}$/.test(key)) continue;
    const file = path.join(directory, key);
    const info = await stat(file);
    if (!info.isFile() || info.mtimeMs > cutoff || await Blob.exists({ key })) continue;
    count += 1;
    console.log(`${apply ? 'Remove' : 'Would remove'} orphan blob ${key} (${info.size} bytes)`);
    if (apply) await unlink(file);
  }
  console.log(`${count} orphan(s). ${apply ? 'Cleanup complete.' : 'Dry run only; no files changed.'}`);
} finally {
  await disconnectDatabase();
}
