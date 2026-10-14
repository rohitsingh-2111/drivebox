// Optional real-process check. Requires npm install, npm run build, internet on
// the first run, and free ports 4000/27117. Run: npm run test:desktop
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const baseUrl = 'http://127.0.0.1:4000';
const origin = 'http://localhost:4000';
const startupLimit = 300000;

async function requireFreePort(port) {
  const server = createServer();
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen({ host: '127.0.0.1', port, exclusive: true }, resolve);
    });
  } catch (error) {
    throw new Error(`Cannot run desktop persistence check: port ${port} is unavailable. Close your running Drivebox instance and retry. No existing process was stopped.`, { cause: error });
  } finally {
    if (server.listening) await new Promise(resolve => server.close(resolve));
  }
}

function launch(dataDirectory) {
  const child = spawn(process.execPath, ['scripts/desktop.mjs'], {
    cwd: projectRoot,
    env: { ...process.env, DRIVEBOX_DATA_DIR: dataDirectory, DRIVEBOX_NO_BROWSER: '1' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true,
  });
  const state = { child, output: '', ready: false, exited: false, exit: null, spawnError: null };
  const capture = chunk => {
    state.output = (state.output + chunk.toString()).slice(-24000);
    if (state.output.includes(`Drivebox is ready: ${origin}`)) state.ready = true;
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  state.done = new Promise(resolve => {
    child.once('error', error => {
      state.spawnError = error;
      state.exited = true;
      resolve();
    });
    child.once('exit', (code, signal) => {
      state.exited = true;
      state.exit = { code, signal };
      resolve();
    });
  });
  return state;
}

async function waitUntilReady(state) {
  const deadline = Date.now() + startupLimit;
  while (Date.now() < deadline) {
    if (state.exited) throw new Error(`Desktop launcher exited before becoming ready.\n${state.spawnError?.message || ''}\n${state.output}`);
    // The child's own readiness message establishes ownership before any API
    // mutations; a separately running service cannot satisfy this condition.
    if (state.ready) {
      try {
        const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(1500) });
        if (response.ok && (await response.json()).status === 'ok') return;
      } catch { /* Keep waiting for the owned launcher. */ }
    }
    await delay(200);
  }
  throw new Error(`Desktop launcher did not become ready within five minutes.\n${state.output}`);
}

async function waitForExit(state, timeout) {
  let timer;
  try {
    return await Promise.race([
      state.done.then(() => true),
      new Promise(resolve => { timer = setTimeout(() => resolve(false), timeout); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function stop(state) {
  if (!state.exited) {
    if (process.platform === 'win32') {
      // Node's child.kill('SIGTERM') forcibly exits on Windows. The private IPC
      // channel asks the same shutdown routine used by the console's Ctrl+C.
      await new Promise((resolve, reject) => {
        state.child.send({ type: 'drivebox:shutdown' }, error => error ? reject(error) : resolve());
      });
    } else {
      state.child.kill('SIGTERM');
    }
    if (!await waitForExit(state, startupLimit + 30000)) {
      // Kill only the process this test spawned. Preserve data because its
      // MongoDB child may still need to finish stopping.
      state.child.kill('SIGKILL');
      await waitForExit(state, 5000);
      state.child.unref();
      state.child.stdout.destroy();
      state.child.stderr.destroy();
      if (state.child.connected) state.child.disconnect();
      throw new Error(`Owned desktop launcher did not shut down cleanly. Temporary data is preserved.\n${state.output}`);
    }
  }
  assert.equal(state.exit?.code, 0, `Desktop launcher failed to exit cleanly.\n${state.output}`);
  await requireFreePort(4000);
  await requireFreePort(27117);
}

async function api(url, { cookie, body, method = 'GET', expected = 200 } = {}) {
  const headers = { Origin: origin };
  if (cookie) headers.Cookie = cookie;
  if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${baseUrl}/api${url}`, {
    method, headers,
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  if (response.status !== expected) {
    assert.fail(`${method} ${url}: expected ${expected}, got ${response.status}: ${await response.text()}`);
  }
  return response;
}

function sessionCookie(response) {
  const cookie = response.headers.getSetCookie().find(value => value.startsWith('drivebox_session='));
  assert.ok(cookie, 'Login/registration must return a session cookie.');
  return cookie.split(';')[0];
}

test('desktop restart preserves accounts, session secret, folders, and uploaded bytes', { timeout: 1200000 }, async t => {
  await requireFreePort(4000);
  await requireFreePort(27117);
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'drivebox-desktop-check-'));
  let current;
  let safeToRemove = true;
  const credentials = { email: 'desktop-check@example.test', password: 'Desktop-check-password-42!' };
  const content = 'This upload must survive an actual MongoDB and application restart.\n';
  try {
    current = launch(dataDirectory);
    safeToRemove = false;
    await waitUntilReady(current);
    const registration = await api('/auth/register', { method: 'POST', body: { ...credentials, name: 'Desktop Check' }, expected: 201 });
    const cookie = sessionCookie(registration);
    const user = (await registration.json()).user;
    const folder = (await (await api('/folders', { method: 'POST', cookie, body: { name: 'Saved folder' }, expected: 201 })).json()).item;
    const form = new FormData();
    form.set('parentId', folder.id);
    form.set('file', new Blob([content], { type: 'text/plain' }), 'saved.txt');
    const file = (await (await api('/files', { method: 'POST', cookie, body: form, expected: 201 })).json()).item;
    assert.equal(await (await api(`/files/${file.id}/download`, { cookie })).text(), content);

    await stop(current);
    current = null;
    safeToRemove = true;
    current = launch(dataDirectory);
    safeToRemove = false;
    await waitUntilReady(current);

    // Keeping the pre-restart cookie proves the secret and session records were
    // preserved, beyond merely being able to create another login session.
    const me = (await (await api('/auth/me', { cookie })).json()).user;
    assert.equal(me.id, user.id);
    assert.equal(me.usedBytes, Buffer.byteLength(content));
    const login = await api('/auth/login', { method: 'POST', body: credentials });
    const newCookie = sessionCookie(login);
    assert.equal((await login.json()).user.id, user.id);
    const rootItems = (await (await api('/items', { cookie: newCookie })).json()).items;
    assert.ok(rootItems.some(item => item.id === folder.id && item.name === 'Saved folder'));
    const nestedItems = (await (await api(`/items?parentId=${folder.id}`, { cookie: newCookie })).json()).items;
    assert.ok(nestedItems.some(item => item.id === file.id && item.name === 'saved.txt'));
    assert.equal(await (await api(`/files/${file.id}/download`, { cookie: newCookie })).text(), content);
    await stop(current);
    current = null;
    safeToRemove = true;
  } finally {
    if (current) {
      try {
        await stop(current);
        safeToRemove = true;
      } catch (error) {
        t.diagnostic(error.message);
      }
    }
    if (safeToRemove) await rm(dataDirectory, { recursive: true, force: true });
    else t.diagnostic(`Temporary data was preserved for inspection: ${dataDirectory}`);
  }
});
