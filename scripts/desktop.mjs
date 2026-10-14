import { createServer as createHttpServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { mkdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { assertSupportedNode, desktopPaths, loadDesktopSecret, desktopConfig } from './desktop-support.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const paths = desktopPaths(projectRoot);
const appUrl = 'http://localhost:4000';
const databasePort = 27117;
let mongo;
let disconnectDatabase;
let stopping = false;
let shutdownTask;
let exitCode = 0;
const activeResponses = new Set();

function unavailable(_req, res) {
  res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '5', Connection: 'close' });
  res.end(stopping ? 'Drivebox is shutting down.' : 'Drivebox is starting. Please refresh in a few seconds.');
}
let handler = unavailable;
// Reserve the actual app port before touching the database. This is an atomic
// single-instance lock, automatically released by the OS if Node crashes.
const httpServer = createHttpServer((req, res) => {
  activeResponses.add(res);
  const finished = () => activeResponses.delete(res);
  res.once('finish', finished);
  res.once('close', finished);
  handler(req, res);
});
httpServer.requestTimeout = 120000;

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const failed = error => { server.off('listening', ready); reject(error); };
    const ready = () => { server.off('error', failed); resolve(); };
    server.once('error', failed);
    server.once('listening', ready);
    server.listen(port, '127.0.0.1');
  });
}

async function checkDatabasePort() {
  const probe = createTcpServer();
  try {
    await listen(probe, databasePort);
  } catch (error) {
    if (error.code === 'EADDRINUSE') {
      throw new Error(`Local database port ${databasePort} is already in use. Close the other Drivebox window, wait a few seconds, and try again. If a previous window crashed, restart Windows. Do not delete .local-data.`);
    }
    throw error;
  } finally {
    if (probe.listening) await new Promise(resolve => probe.close(resolve));
  }
}

function openBrowser() {
  if (process.env.DRIVEBOX_NO_BROWSER === '1') return;
  const command = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  // Pass an argument array, never a shell command containing the URL.
  const child = spawn(command, [appUrl], { detached: true, stdio: 'ignore', windowsHide: true });
  child.once('error', () => console.log(`Open ${appUrl} in your browser.`));
  child.unref();
}

async function start() {
  assertSupportedNode();
  try {
    await access(paths.client);
  } catch {
    throw new Error('The browser app has not been built. Run Start-Drivebox.cmd, or run npm install --include=dev followed by npm run build, then npm run desktop.');
  }
  if (stopping) return;
  try {
    await listen(httpServer, 4000);
  } catch (error) {
    if (error.code === 'EADDRINUSE') {
      throw new Error(`Port 4000 is already in use. If Drivebox is open, use ${appUrl}. Otherwise close the program using that port and try again.`);
    }
    throw error;
  }
  if (stopping) return;
  await checkDatabasePort();
  if (stopping) return;
  await mkdir(paths.database, { recursive: true, mode: 0o700 });
  await mkdir(paths.binaries, { recursive: true, mode: 0o700 });
  const sessionSecret = await loadDesktopSecret(paths.secret);
  if (stopping) return;

  let MongoMemoryReplSet;
  let createApp;
  let connectDatabase;
  try {
    ({ MongoMemoryReplSet } = await import('mongodb-memory-server'));
    ({ createApp } = await import('../server/src/app.js'));
    ({ connectDatabase, disconnectDatabase } = await import('../server/src/db.js'));
  } catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND') {
      throw new Error('Some application packages are missing. Run npm install --include=dev in the Drivebox folder, then open Start-Drivebox.cmd again.');
    }
    throw error;
  }
  if (stopping) return;
  console.log('Starting your local MongoDB database...');
  console.log('The first start downloads MongoDB and needs an internet connection. Please keep this window open.');
  mongo = new MongoMemoryReplSet({
    // A real MongoDB process with disk-backed WiredTiger, NOT an ephemeral DB.
    binary: { version: '7.0.45', downloadDir: paths.binaries },
    instanceOpts: [{ port: databasePort, dbPath: paths.database, storageEngine: 'wiredTiger' }],
    replSet: { count: 1, name: 'rs0', ip: '127.0.0.1', storageEngine: 'wiredTiger' },
  });
  await mongo.start();
  if (stopping) return;
  const mongoUri = mongo.getUri('drivebox');
  if (!mongoUri.startsWith(`mongodb://127.0.0.1:${databasePort}/`)) {
    throw new Error(`MongoDB could not use its saved port ${databasePort}. Close other database processes and try again. Your .local-data folder is preserved.`);
  }
  await connectDatabase(mongoUri);
  if (stopping) return;
  handler = createApp({ config: desktopConfig(paths, sessionSecret, mongoUri) });
  console.log(`\nDrivebox is ready: ${appUrl}`);
  console.log('Register an account in the browser to begin.');
  console.log(`Your accounts and files are saved in: ${paths.data}`);
  console.log('Keep this window open while using Drivebox. Press Ctrl+C here to stop safely.\n');
  openBrowser();
}

async function shutdown() {
  if (shutdownTask) return shutdownTask;
  shutdownTask = (async () => {
    handler = unavailable;
    // Keep the listening socket (and therefore single-instance lock) until the
    // database is stopped. Give in-flight requests up to 10 seconds to finish.
    const pending = [...activeResponses].map(res => new Promise(resolve => {
      if (res.writableFinished || res.destroyed) return resolve();
      res.once('finish', resolve);
      res.once('close', resolve);
    }));
    let drainTimer;
    await Promise.race([
      Promise.all(pending),
      new Promise(resolve => { drainTimer = setTimeout(resolve, 10000); }),
    ]);
    clearTimeout(drainTimer);
    httpServer.closeAllConnections();
    try {
      await disconnectDatabase?.();
    } catch (error) {
      exitCode = 1;
      console.error(`Could not close the app database connection: ${error.message}`);
    }
    try {
      // Never clean up this explicit, persistent database path.
      await mongo?.stop({ doCleanup: false, force: false });
    } catch (error) {
      exitCode = 1;
      console.error(`Could not stop MongoDB cleanly: ${error.message}`);
      console.error('Keep .local-data intact. If the next start reports a busy port, restart Windows.');
    }
    if (httpServer.listening) await new Promise(resolve => httpServer.close(resolve));
    if (process.connected) process.disconnect();
    process.exitCode = exitCode;
  })();
  return shutdownTask;
}

const startupTask = start().catch(error => {
  exitCode = 1;
  stopping = true;
  console.error(`\nDrivebox could not start: ${error.message}`);
  console.error('If the message mentions downloading MongoDB, check your internet connection and try again.');
  console.error('Your .local-data folder is preserved.\n');
});

const requestStop = () => {
  if (stopping) return;
  stopping = true;
  console.log('\nStopping Drivebox safely. Waiting for active startup or file operations to finish...');
  // Do not race .stop() against MongoDB download/startup.
  void startupTask.then(shutdown);
};
process.on('SIGINT', requestStop);
process.on('SIGTERM', requestStop);
if (process.platform === 'win32') process.on('SIGBREAK', requestStop);
// Optional parent-process IPC lets the real persistence test stop gracefully on
// Windows, where child.kill('SIGTERM') would forcibly terminate the child.
if (process.send) {
  process.on('message', message => {
    if (message?.type === 'drivebox:shutdown') requestStop();
  });
  process.on('disconnect', requestStop);
}
await startupTask;
if (stopping) await shutdown();
