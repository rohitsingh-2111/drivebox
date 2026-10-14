import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { mkdir, open, readFile } from 'node:fs/promises';

export function assertSupportedNode(version = process.versions.node) {
  const [major, minor] = version.split('.').map(Number);
  if (!Number.isInteger(major) || !Number.isInteger(minor) || major < 22 || (major === 22 && minor < 12)) {
    throw new Error('Drivebox needs Node.js 22.12 or newer. Install the current LTS version from https://nodejs.org, then reopen this window.');
  }
}

export function desktopPaths(projectRoot, dataDirectory = process.env.DRIVEBOX_DATA_DIR) {
  const data = dataDirectory ? path.resolve(projectRoot, dataDirectory) : path.join(projectRoot, '.local-data');
  return {
    data,
    database: path.join(data, 'mongodb'),
    uploads: path.join(data, 'uploads'),
    secret: path.join(data, 'session-secret'),
    binaries: path.join(data, 'mongodb-binaries'),
    client: path.join(projectRoot, 'client', 'dist', 'index.html'),
  };
}

export async function loadDesktopSecret(filename) {
  await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
  try {
    const handle = await open(filename, 'wx', 0o600);
    try {
      await handle.writeFile(randomBytes(48).toString('hex') + '\n', 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  const secret = (await readFile(filename, 'utf8')).trim();
  if (!/^[a-f0-9]{96}$/.test(secret)) {
    throw new Error('The saved session-secret file is damaged. Restore .local-data/session-secret from your backup; your existing data has not been changed.');
  }
  return secret;
}

export function desktopConfig(paths, sessionSecret, mongoUri) {
  return {
    production: true,
    port: 4000,
    mongoUri,
    clientOrigin: 'http://localhost:4000',
    storageDir: paths.uploads,
    sessionSecret,
    sessionDays: 7,
    quotaBytes: 100 * 1024 * 1024,
    maxUploadBytes: 25 * 1024 * 1024,
  };
}
