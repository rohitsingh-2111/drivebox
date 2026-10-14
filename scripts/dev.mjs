import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = ['@drivebox/server', '@drivebox/client'].map(workspace =>
  spawn(npm, ['run', 'dev', '--workspace', workspace], {
    cwd: root, stdio: 'inherit', shell: process.platform === 'win32',
  })
);
let stopping = false;
function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill('SIGTERM');
}
for (const child of children) {
  child.on('error', error => { console.error(error.message); shutdown(1); });
  child.on('exit', code => shutdown(code ?? 1));
}
process.on('SIGINT', () => shutdown(130));
process.on('SIGTERM', () => shutdown(143));
