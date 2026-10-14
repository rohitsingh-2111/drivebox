import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const example = await readFile(new URL('.env.example', root), 'utf8');
const env = example.replace(/^SESSION_SECRET=.*$/m, `SESSION_SECRET=${randomBytes(48).toString('hex')}`);
try {
  await writeFile(new URL('.env', root), env, { flag: 'wx', mode: 0o600 });
  console.log(`Created ${fileURLToPath(new URL('.env', root))} with a new session secret.`);
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.log('.env already exists; your settings were preserved.');
}
