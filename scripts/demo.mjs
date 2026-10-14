import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

// Run against a real, running Drivebox instance. No requests are mocked.
// Install the browser once with `npx playwright install chromium`.
const baseURL = (process.env.DEMO_URL || 'http://localhost:4000').replace(/\/$/, '');
const origin = new URL(baseURL).origin;
const runId = `${Date.now()}-${randomUUID().slice(0, 8)}`;
const output = path.resolve('demo-output', runId);
const owner = { name: 'Alex Morgan', email: `owner-${runId}@example.com`, password: `Owner-${randomUUID()}!` };
const editor = { name: 'Jordan Lee', email: `editor-${runId}@example.com`, password: `Editor-${randomUUID()}!` };
const folderName = 'Launch project';
const nestedName = 'Briefs';
const fileName = 'launch-brief.txt';
const v1 = 'DRIVEBOX LAUNCH BRIEF\nVersion 1: A thoughtful home for your work.\n';
const v2 = 'DRIVEBOX LAUNCH BRIEF\nVersion 2: Updated copy, with the original safely retained.\n';
const v4 = 'DRIVEBOX LAUNCH BRIEF\nVersion 4: Jordan added this through inherited editor access.\n';
const evidence = { runId, baseURL, startedAt: new Date().toISOString(), steps: [], completed: false };
let browser;
let ownerContext;
let editorContext;
let page;
let video;

function matches(response, method, pathname) {
  return response.request().method() === method && new URL(response.url()).pathname === `/api${pathname}`;
}

async function responseFor(target, method, pathname, action, { refresh = false, status = 200 } = {}) {
  const responsePromise = target.waitForResponse(response => matches(response, method, pathname));
  const listingPromise = refresh
    ? target.waitForResponse(response => matches(response, 'GET', '/items'))
    : null;
  await action();
  const response = await responsePromise;
  const body = response.status() === 204 ? null : await response.json();
  assert.equal(response.status(), status, `${method} ${pathname}: ${JSON.stringify(body)}`);
  if (listingPromise) {
    const listing = await listingPromise;
    assert.equal(listing.status(), 200, `Listing failed after ${method} ${pathname}`);
    await target.locator('.file-loading').waitFor({ state: 'hidden' });
  }
  return body;
}

async function step(label, screenshot = true) {
  console.log(`✓ ${label}`);
  evidence.steps.push({ label, at: new Date().toISOString() });
  if (screenshot && page) {
    await page.waitForTimeout(900); // Give each recorded milestone time to read.
    const number = String(evidence.steps.length).padStart(2, '0');
    const filename = `${number}-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '')}.png`;
    await page.screenshot({ path: path.join(output, filename), fullPage: true });
  }
}

async function register(target, account) {
  await target.goto(baseURL);
  await target.getByRole('button', { name: 'Create an account', exact: true }).click();
  await target.getByLabel('Full name', { exact: true }).fill(account.name);
  await target.getByLabel('Email address', { exact: true }).fill(account.email);
  await target.getByLabel('Password', { exact: true }).fill(account.password);
  const result = await responseFor(target, 'POST', '/auth/register', () => target.getByRole('button', { name: 'Create account', exact: true }).click(), { status: 201, refresh: true });
  assert.equal(result.user.email, account.email);
  await target.getByRole('heading', { name: /My files/ }).waitFor();
  return result.user;
}

async function login(target, account) {
  await target.getByLabel('Email address', { exact: true }).fill(account.email);
  await target.getByLabel('Password', { exact: true }).fill(account.password);
  const result = await responseFor(target, 'POST', '/auth/login', () => target.locator('form').getByRole('button', { name: 'Sign in', exact: true }).click(), { refresh: true });
  assert.equal(result.user.email, account.email);
}

async function logout(target) {
  await responseFor(target, 'POST', '/auth/logout', () => target.getByRole('button', { name: 'Sign out', exact: true }).click(), { status: 204 });
  await target.getByRole('heading', { name: 'Welcome back.', exact: true }).waitFor();
}

async function navigate(target, view) {
  await responseFor(target, 'GET', '/items', () => target.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: view, exact: true }).click());
  await target.locator('.file-loading').waitFor({ state: 'hidden' });
}

async function openFolder(target, name) {
  await responseFor(target, 'GET', '/items', () => target.locator('.file-name-button').filter({ hasText: name }).click());
  await target.getByRole('heading', { name, exact: true }).waitFor();
  await target.locator('.file-loading').waitFor({ state: 'hidden' });
}

async function menuAction(target, name, action) {
  await target.getByRole('button', { name: `Actions for ${name}`, exact: true }).click();
  await target.getByRole('menu', { name: `Actions for ${name}`, exact: true }).getByRole('menuitem', { name: action, exact: true }).click();
}

async function createFolder(target, name) {
  await target.getByRole('button', { name: 'New folder', exact: true }).click();
  const dialog = target.getByRole('dialog');
  await dialog.getByLabel('Folder name', { exact: true }).fill(name);
  const result = await responseFor(target, 'POST', '/folders', () => dialog.getByRole('button', { name: 'Create folder', exact: true }).click(), { status: 201, refresh: true });
  await dialog.waitFor({ state: 'hidden' });
  await target.getByRole('button', { name: `Actions for ${name}`, exact: true }).waitFor();
  return result.item;
}

async function upload(target, contents, itemId = null) {
  if (itemId) await menuAction(target, fileName, 'Upload new version');
  else await target.locator('main').getByRole('button', { name: 'Upload files', exact: true }).click();
  const dialog = target.getByRole('dialog');
  await dialog.getByLabel(itemId ? 'Select new version' : 'Select files to upload', { exact: true }).setInputFiles({ name: fileName, mimeType: 'text/plain', buffer: Buffer.from(contents) });
  const result = await responseFor(target, 'POST', itemId ? `/files/${itemId}/versions` : '/files', () => dialog.getByRole('button', { name: 'Upload', exact: true }).click(), { status: 201, refresh: true });
  await dialog.waitFor({ state: 'hidden' });
  await target.getByRole('button', { name: `Actions for ${fileName}`, exact: true }).waitFor();
  return result.item;
}

async function setShare(target, folder, role) {
  await responseFor(target, 'GET', `/items/${folder.id}/shares`, () => menuAction(target, folder.name, 'Manage sharing'));
  const dialog = target.getByRole('dialog');
  await dialog.getByLabel('Add someone by email', { exact: true }).fill(editor.email);
  await dialog.getByLabel('Sharing permission', { exact: true }).selectOption(role);
  const result = await responseFor(target, 'PUT', `/items/${folder.id}/shares`, () => dialog.getByRole('button', { name: 'Share', exact: true }).click(), { refresh: true });
  assert.equal(result.shares.find(share => share.email === editor.email)?.role, role);
  await dialog.locator('.role-label').filter({ hasText: role }).waitFor();
  await step(`Folder shared with ${role} access`);
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
}

// Downloads use the same browser flow as a user and verify the saved file bytes.
async function downloadAndVerify(target, itemId, expected, filename) {
  const event = target.waitForEvent('download');
  const responsePromise = target.waitForResponse(response => matches(response, 'GET', `/files/${itemId}/download`));
  await menuAction(target, fileName, 'Download');
  const response = await responsePromise;
  assert.equal(response.status(), 200, 'Download request must succeed');
  const file = await event;
  assert.equal(await file.failure(), null);
  assert.equal(file.suggestedFilename(), fileName);
  const destination = path.join(output, filename);
  await file.saveAs(destination);
  assert.equal(await readFile(destination, 'utf8'), expected, 'Downloaded bytes must match the expected immutable version');
}

await mkdir(output, { recursive: true });
try {
  browser = await chromium.launch({ headless: process.env.DEMO_HEADED !== '1', slowMo: 200 });
  // This second real browser context has its own cookies; its setup is not recorded.
  editorContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  editorContext.setDefaultTimeout(20_000);
  const health = await editorContext.request.get(`${baseURL}/api/health`);
  assert.equal(health.status(), 200, `Start Drivebox before recording: ${baseURL}/api/health`);
  const collaborator = await editorContext.newPage();
  const collaboratorUser = await register(collaborator, editor);
  ownerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true, recordVideo: { dir: output, size: { width: 1440, height: 1000 } } });
  ownerContext.setDefaultTimeout(20_000);
  page = await ownerContext.newPage();
  video = page.video();
  await register(page, owner);
  await step('Owner account registered');

  const folder = await createFolder(page, folderName);
  await openFolder(page, folderName);
  const nested = await createFolder(page, nestedName);
  await openFolder(page, nestedName);
  let file = await upload(page, v1);
  assert.equal(file.parentId, nested.id);
  await step('Nested folder created and first version uploaded');

  await navigate(page, 'My files');
  await setShare(page, folder, 'viewer');
  await navigate(collaborator, 'Shared with me');
  await openFolder(collaborator, folderName);
  await openFolder(collaborator, nestedName);
  await collaborator.getByRole('button', { name: `Actions for ${fileName}`, exact: true }).click();
  const viewerMenu = collaborator.getByRole('menu');
  assert.equal(await viewerMenu.getByRole('menuitem', { name: 'Upload new version', exact: true }).count(), 0);
  assert.equal(await viewerMenu.getByRole('menuitem', { name: 'Rename', exact: true }).count(), 0);
  await collaborator.keyboard.press('Escape');
  const denied = await editorContext.request.patch(`${baseURL}/api/items/${file.id}`, { headers: { Origin: origin }, data: { name: 'must-not-change.txt', revision: file.revision } });
  assert.equal(denied.status(), 403, 'The server must reject a viewer attempting to rename');
  await downloadAndVerify(collaborator, file.id, v1, 'viewer-download.txt');
  await step('Viewer can download but cannot edit', false);

  await setShare(page, folder, 'editor');
  await openFolder(page, folderName);
  await openFolder(page, nestedName);
  file = await upload(page, v2, file.id);
  await step('Second file version uploaded');
  await downloadAndVerify(page, file.id, v2, 'version-2-download.txt');

  const history = await responseFor(page, 'GET', `/files/${file.id}/versions`, () => menuAction(page, fileName, 'Version history'));
  assert.equal(history.total, 2);
  const firstVersion = history.versions.find(version => version.number === 1);
  assert.ok(firstVersion, 'Version 1 must remain in history');
  const historyDialog = page.getByRole('dialog');
  await historyDialog.locator('.version-row').filter({ hasText: 'Version 1' }).waitFor();
  await step('Immutable version history displayed');
  const historyRefresh = page.waitForResponse(response => matches(response, 'GET', `/files/${file.id}/versions`));
  const restored = await responseFor(page, 'POST', `/files/${file.id}/versions/${firstVersion.id}/restore`, () => historyDialog.locator('.version-row').filter({ hasText: 'Version 1' }).getByRole('button', { name: 'Restore', exact: true }).click(), { refresh: true });
  file = restored.item;
  const restoredHistory = await (await historyRefresh).json();
  assert.equal(restoredHistory.total, 3, 'Restoring must append a version');
  assert.equal(restoredHistory.versions.find(version => version.current)?.number, 3);
  await historyDialog.locator('.version-row').filter({ hasText: 'Version 3' }).waitFor();
  await step('Original contents restored as version 3');
  await historyDialog.getByRole('button', { name: 'Done', exact: true }).click();
  await downloadAndVerify(page, file.id, v1, 'restored-version-download.txt');

  await navigate(page, 'My files');
  await menuAction(page, folderName, 'Move to Trash');
  await responseFor(page, 'DELETE', `/items/${folder.id}`, () => page.getByRole('dialog').getByRole('button', { name: 'Move to Trash', exact: true }).click(), { status: 204, refresh: true });
  await navigate(page, 'Trash');
  await page.getByRole('button', { name: `Actions for ${folderName}`, exact: true }).waitFor();
  const hiddenChild = await editorContext.request.get(`${baseURL}/api/files/${file.id}/download`);
  assert.equal(hiddenChild.status(), 404, 'Trashing an ancestor must stop shared child access');
  await step('Folder and descendants moved to Trash');
  await responseFor(page, 'POST', `/items/${folder.id}/restore`, () => menuAction(page, folderName, 'Restore'), { refresh: true });
  await navigate(page, 'My files');
  await openFolder(page, folderName);
  await openFolder(page, nestedName);
  await downloadAndVerify(page, file.id, v1, 'after-trash-restore-download.txt');
  await step('Folder restored and original download verified');

  await logout(page);
  await login(page, editor);
  await navigate(page, 'Shared with me');
  await page.locator('tbody tr').filter({ hasText: folderName }).getByText('Can edit', { exact: true }).waitFor();
  await openFolder(page, folderName);
  await openFolder(page, nestedName);
  await step('Signed in as collaborator with inherited editor access');
  file = await upload(page, v4, file.id);
  assert.equal(file.permission, 'editor');
  await downloadAndVerify(page, file.id, v4, 'editor-version-download.txt');
  await step('Collaborator uploaded and downloaded version 4');

  // Finish by proving revocation, including server-side access to a child.
  await logout(page);
  await login(page, owner);
  await menuAction(page, folderName, 'Manage sharing');
  const sharing = page.getByRole('dialog');
  await responseFor(page, 'DELETE', `/items/${folder.id}/shares/${collaboratorUser.id}`, () => sharing.getByRole('button', { name: `Remove access for ${editor.email}`, exact: true }).click(), { status: 204, refresh: true });
  const revoked = await editorContext.request.get(`${baseURL}/api/files/${file.id}/download`);
  assert.equal(revoked.status(), 404, 'Revoking the sole ancestor grant must remove access to its child');
  await sharing.getByText('Only you have direct access.', { exact: true }).waitFor();
  await step('Sharing revoked and child access denied');
  await sharing.getByRole('button', { name: 'Done', exact: true }).click();
  await step('Demo complete');
  evidence.completed = true;
} catch (error) {
  evidence.error = error.stack || String(error);
  console.error(`Demo failed: ${error.message}`);
  console.error('Check that Drivebox is running at DEMO_URL and Chromium is installed: npx playwright install chromium');
  if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await editorContext?.close().catch(() => {});
  await ownerContext?.close().catch(() => {});
  if (video) {
    const videoPath = path.join(output, 'drivebox-demo.webm');
    await video.saveAs(videoPath).then(() => { evidence.video = videoPath; console.log(`Video: ${videoPath}`); }).catch(error => {
      evidence.completed = false;
      evidence.videoError = error.message;
      process.exitCode = 1;
      console.error(`Could not save video: ${error.message}`);
    });
  }
  await browser?.close().catch(() => {});
  evidence.finishedAt = new Date().toISOString();
  await writeFile(path.join(output, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`Screenshots, downloads and evidence: ${output}`);
  console.log(evidence.completed ? 'All live demo assertions passed. Review the full video before submitting it.' : 'Recording is incomplete. Fix the reported failure and rerun before submitting.');
}
