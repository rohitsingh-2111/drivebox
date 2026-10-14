import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { assertSupportedNode, desktopPaths, loadDesktopSecret, desktopConfig } from '../scripts/desktop-support.mjs';

async function fixture(context) {
  const directory = await mkdtemp(path.join(process.cwd(), '.drivebox-test-desktop-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('desktop launcher accepts supported Node versions and rejects older runtimes', () => {
  for (const version of ['22.12.0', '22.23.3', '24.19.0']) assert.doesNotThrow(() => assertSupportedNode(version));
  for (const version of ['18.20.0', '20.19.0', '22.11.9', 'invalid']) assert.throws(() => assertSupportedNode(version), /Node.js 22.12/);
});

test('desktop storage has a stable project path and allows isolated test data', () => {
  const root = path.resolve('example-project');
  const defaults = desktopPaths(root, '');
  assert.equal(defaults.data, path.join(root, '.local-data'));
  assert.equal(defaults.database, path.join(defaults.data, 'mongodb'));
  assert.equal(defaults.uploads, path.join(defaults.data, 'uploads'));
  assert.equal(desktopPaths(root, 'test-data').data, path.join(root, 'test-data'));
  const outside = path.resolve('isolated-fixture');
  assert.equal(desktopPaths(root, outside).data, outside);
});

test('desktop session secret persists unchanged across restarts', async context => {
  const root = await fixture(context);
  const filename = path.join(root, 'private', 'session-secret');
  const first = await loadDesktopSecret(filename);
  const original = await readFile(filename, 'utf8');
  const second = await loadDesktopSecret(filename);
  assert.match(first, /^[a-f0-9]{96}$/);
  assert.equal(second, first);
  assert.equal(await readFile(filename, 'utf8'), original);
  if (process.platform !== 'win32') assert.equal((await stat(filename)).mode & 0o777, 0o600);
});

test('a damaged desktop secret is reported without replacing existing data', async context => {
  const root = await fixture(context);
  const filename = path.join(root, 'session-secret');
  await writeFile(filename, 'damaged-existing-value');
  await assert.rejects(loadDesktopSecret(filename), /damaged/);
  assert.equal(await readFile(filename, 'utf8'), 'damaged-existing-value');
});

test('desktop uses its own configured database and private upload location', () => {
  const paths = desktopPaths(path.resolve('example-project'), '');
  const secret = 'a'.repeat(96);
  const uri = 'mongodb://127.0.0.1:27117/drivebox?replicaSet=rs0';
  const config = desktopConfig(paths, secret, uri);
  assert.equal(config.production, true);
  assert.equal(config.port, 4000);
  assert.equal(config.clientOrigin, 'http://localhost:4000');
  assert.equal(config.mongoUri, uri);
  assert.equal(config.storageDir, paths.uploads);
  assert.equal(config.sessionSecret, secret);
  assert.equal(config.quotaBytes, 104857600);
  assert.equal(config.maxUploadBytes, 26214400);
});

test('desktop refuses an occupied app port before touching data and leaves the other server running', async context => {
  const other = createServer((_request, response) => response.end('unrelated application'));
  try {
    await new Promise((resolve, reject) => {
      other.once('error', reject);
      other.listen(4000, '127.0.0.1', resolve);
    });
  } catch (error) {
    if (error.code === 'EADDRINUSE') return context.skip('Port 4000 is already occupied; no existing service was touched.');
    throw error;
  }
  context.after(() => new Promise(resolve => { other.closeAllConnections(); other.close(resolve); }));
  const root = await fixture(context);
  const data = path.join(root, 'must-not-be-created');
  const launcher = fileURLToPath(new URL('../scripts/desktop.mjs', import.meta.url));
  await assert.rejects(promisify(execFile)(process.execPath, [launcher], {
    env: { ...process.env, DRIVEBOX_DATA_DIR: data, DRIVEBOX_NO_BROWSER: '1' },
    timeout: 10_000,
  }), error => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /Port 4000 is already in use/);
    return true;
  });
  await assert.rejects(stat(data), { code: 'ENOENT' });
  assert.equal(await (await fetch('http://127.0.0.1:4000')).text(), 'unrelated application');
});
