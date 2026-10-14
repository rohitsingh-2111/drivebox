import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm, unlink } from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import request from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createApp } from '../server/src/app.js';
import { connectDatabase, disconnectDatabase } from '../server/src/db.js';
import { Blob, FileVersion, Item, User } from '../server/src/models.js';

const ORIGIN = 'http://localhost:5173';
const PASSWORD = 'Integration-only-password-42!';
const UPLOAD_LIMIT = 4096;
const databaseName = `drivebox_test_${randomUUID().replaceAll('-', '')}`;
let app;
let connection;
let replicaSet;
let fixtureRoot;
let storageDir;

// Even when an external URI is supplied, use an isolated database. Preserve the
// original authentication database rather than authenticating against our new DB.
function isolatedUri(uri) {
  const match = /^(mongodb(?:\+srv)?:\/\/[^/?]+)(?:\/([^?]*))?(?:\?(.*))?$/.exec(uri);
  if (!match) throw new Error('TEST_MONGODB_URI must be a MongoDB connection URI.');
  const query = new URLSearchParams(match[3] || '');
  if (match[1].includes('@') && !query.has('authSource')) {
    query.set('authSource', decodeURIComponent(match[2] || 'admin'));
  }
  return `${match[1]}/${databaseName}${query.size ? `?${query}` : ''}`;
}

function api(actor, method, url) {
  return actor.agent[method](`/api${url}`).set('Origin', ORIGIN);
}

async function account(label = 'User') {
  const agent = request.agent(app);
  const email = `${label.toLowerCase()}-${randomUUID()}@example.test`;
  const response = await agent.post('/api/auth/register').set('Origin', ORIGIN)
    .send({ name: label, email, password: PASSWORD }).expect(201);
  return { agent, email, user: response.body.user, registration: response };
}

async function folder(actor, name, parentId) {
  const response = await api(actor, 'post', '/folders')
    .send({ name, ...(parentId === undefined ? {} : { parentId }) }).expect(201);
  return response.body.item;
}

function uploadRequest(actor, name, content, parentId) {
  let upload = api(actor, 'post', '/files');
  if (parentId !== undefined) upload = upload.field('parentId', parentId);
  return upload.attach('file', Buffer.from(content), { filename: name, contentType: 'text/plain' });
}

async function upload(actor, name, content, parentId) {
  const response = await uploadRequest(actor, name, content, parentId).expect(201);
  return response.body.item;
}

function versionRequest(actor, file, content, revision) {
  let upload = api(actor, 'post', `/files/${file.id}/versions`);
  if (revision !== undefined) upload = upload.field('revision', String(revision));
  return upload.attach('file', Buffer.from(content), { filename: file.name, contentType: 'text/plain' });
}

async function share(owner, item, recipient, role) {
  return api(owner, 'put', `/items/${item.id}/shares`).send({ email: recipient.email, role }).expect(200);
}

function readBytes(response, callback) {
  const chunks = [];
  response.on('data', chunk => chunks.push(Buffer.from(chunk)));
  response.on('end', () => callback(null, Buffer.concat(chunks)));
  response.on('error', callback);
}

function download(actor, file, versionId) {
  const query = versionId ? { versionId } : {};
  return api(actor, 'get', `/files/${file.id}/download`).query(query).buffer(true).parse(readBytes);
}

async function usage(actor) {
  return (await api(actor, 'get', '/auth/me').expect(200)).body.user.usedBytes;
}

async function storedFiles(directory = storageDir) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const nested = await Promise.all(entries.map(async entry => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? storedFiles(filename) : [path.relative(storageDir, filename)];
  }));
  return nested.flat().sort();
}

function assertError(response, status, code) {
  assert.equal(response.status, status, JSON.stringify(response.body));
  assert.equal(typeof response.body.error?.message, 'string');
  if (code) assert.equal(response.body.error.code, code);
}

describe('Drivebox API against a real MongoDB replica set', { concurrency: false, timeout: 180_000 }, () => {
  before(async () => {
    fixtureRoot = await mkdtemp(path.join(process.cwd(), '.drivebox-test-'));
    storageDir = path.join(fixtureRoot, 'storage');
    let uri = process.env.TEST_MONGODB_URI;
    if (!uri) {
      replicaSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
      uri = replicaSet.getUri();
    }
    connection = await connectDatabase(isolatedUri(uri));
    assert.equal(connection.db.databaseName, databaseName);
    app = createApp({ config: {
      production: false,
      clientOrigin: ORIGIN,
      sessionSecret: 'integration-tests-use-a-private-fixed-secret-at-least-32-characters',
      storageDir,
      quotaBytes: 65_536,
      maxUploadBytes: UPLOAD_LIMIT,
      authRateLimit: 10_000,
    } });
  }, { timeout: 180_000 });

  after(async () => {
    const failures = [];
    try {
      if (connection?.db) {
        assert.equal(connection.db.databaseName, databaseName, 'Refuse to drop any database except this run\'s generated database.');
        await connection.db.dropDatabase();
      }
    } catch (error) { failures.push(error); }
    try { await disconnectDatabase(); } catch (error) { failures.push(error); }
    try { await replicaSet?.stop(); } catch (error) { failures.push(error); }
    try { if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true }); } catch (error) { failures.push(error); }
    if (failures.length) throw new AggregateError(failures, 'Integration fixture cleanup failed.');
  });

  test('registration, login, secure session attributes, logout, and invalid credentials', async () => {
    const owner = await account('Auth');
    assert.equal(owner.user.email, owner.email);
    assert.equal(owner.user.usedBytes, 0);
    assert.ok(owner.user.quotaBytes > 0);
    assert.equal(owner.user.password, undefined);
    assert.equal(owner.user.passwordHash, undefined);
    const cookie = owner.registration.headers['set-cookie'].join(';');
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
    await api(owner, 'get', '/auth/me').expect(200);
    await api(owner, 'post', '/auth/logout').expect(204);
    await api(owner, 'get', '/auth/me').expect(401);
    await api(owner, 'post', '/auth/login').send({ email: owner.email, password: 'Wrong-password-42!' }).expect(401);
    const login = await api(owner, 'post', '/auth/login')
      .send({ email: owner.email.toUpperCase(), password: PASSWORD }).expect(200);
    assert.equal(login.body.user.id, owner.user.id);
    await request(app).post('/api/auth/register').set('Origin', ORIGIN)
      .send({ name: 'Duplicate', email: owner.email.toUpperCase(), password: PASSWORD }).expect(409);
    await request(app).post('/api/auth/register').set('Origin', ORIGIN)
      .send({ name: 'Invalid', email: 'invalid-email', password: 'short' }).expect(400);
  });

  test('cross-origin mutations are rejected before changing data', async () => {
    const owner = await account('Origin');
    const response = await owner.agent.post('/api/folders').set('Origin', 'https://untrusted.example')
      .send({ name: 'Forbidden folder' });
    assertError(response, 403);
    const listing = await api(owner, 'get', '/items').expect(200);
    assert.equal(listing.body.total, 0);
    await folder(owner, 'Allowed folder');
    await request(app).get('/api/items').expect(401);
  });

  test('private item IDs cannot expose metadata, contents, versions, or sharing', async () => {
    const owner = await account('Private');
    const outsider = await account('Outsider');
    const file = await upload(owner, 'secret.txt', 'private information');
    for (const url of [`/items/${file.id}`, `/files/${file.id}/download`, `/files/${file.id}/versions`, `/items/${file.id}/shares`]) {
      await api(outsider, 'get', url).expect(404);
    }
    await api(outsider, 'patch', `/items/${file.id}`).send({ name: 'Stolen.txt' }).expect(404);
    await api(outsider, 'delete', `/items/${file.id}`).expect(404);
    await api(outsider, 'get', '/items/000000000000000000000001').expect(404);
    const listing = await api(outsider, 'get', '/items').expect(200);
    assert.equal(listing.body.total, 0);
  });

  test('viewer grants inherit through folders and permit reading without mutation', async () => {
    const owner = await account('ViewerOwner');
    const viewer = await account('Viewer');
    const parent = await folder(owner, 'Shared directory');
    const nested = await folder(owner, 'Nested', parent.id);
    const file = await upload(owner, 'readme.txt', 'visible by inheritance', nested.id);
    await share(owner, parent, viewer, 'viewer');
    const shared = await api(viewer, 'get', '/items').query({ view: 'shared' }).expect(200);
    assert.deepEqual(shared.body.items.map(item => item.id), [parent.id]);
    const children = await api(viewer, 'get', '/items').query({ view: 'shared', parentId: parent.id }).expect(200);
    assert.ok(children.body.items.some(item => item.id === nested.id));
    const detail = await api(viewer, 'get', `/items/${file.id}`).expect(200);
    assert.equal(detail.body.item.permission, 'viewer');
    assert.equal((await download(viewer, file).expect(200)).body.toString(), 'visible by inheritance');
    await api(viewer, 'get', `/files/${file.id}/versions`).expect(200);
    await api(viewer, 'post', '/folders').send({ name: 'No rights', parentId: parent.id }).expect(403);
    await api(viewer, 'patch', `/items/${file.id}`).send({ name: 'Changed.txt' }).expect(403);
    const before = await storedFiles();
    await versionRequest(viewer, file, 'forbidden').expect(403);
    assert.deepEqual(await storedFiles(), before, 'Denied multipart mutations must remove their temporary upload.');
    await api(viewer, 'delete', `/items/${file.id}`).expect(403);
    await api(viewer, 'get', `/items/${file.id}/shares`).expect(403);
  });

  test('editors create and edit within shared trees while owner-only operations remain forbidden', async () => {
    const owner = await account('EditorOwner');
    const editor = await account('Editor');
    const parent = await folder(owner, 'Team');
    await share(owner, parent, editor, 'editor');
    const nested = await folder(editor, 'Contributions', parent.id);
    const file = await upload(editor, 'contribution.txt', 'editor contribution', nested.id);
    assert.equal(nested.ownerId, owner.user.id);
    assert.equal(file.ownerId, owner.user.id);
    assert.equal(file.permission, 'editor');
    assert.equal(await usage(owner), Buffer.byteLength('editor contribution'));
    assert.equal(await usage(editor), 0);
    const renamed = await api(editor, 'patch', `/items/${file.id}`).send({ name: 'renamed.txt', revision: file.revision }).expect(200);
    await versionRequest(editor, renamed.body.item, 'updated contribution', renamed.body.item.revision).expect(201);
    await api(editor, 'patch', `/items/${file.id}`).send({ parentId: parent.id }).expect(403);
    await api(editor, 'delete', `/items/${file.id}`).expect(403);
    await api(editor, 'put', `/items/${file.id}/shares`).send({ email: editor.email, role: 'viewer' }).expect(403);
    const ownerListing = await api(owner, 'get', '/items').query({ parentId: nested.id }).expect(200);
    assert.equal(ownerListing.body.items[0].id, file.id);
  });

  test('the highest inherited grant wins and revocation immediately removes only that grant', async () => {
    const owner = await account('RevocationOwner');
    const recipient = await account('Recipient');
    const hiddenParent = await folder(owner, 'Private parent label');
    const file = await upload(owner, 'direct.txt', 'old bytes', hiddenParent.id);
    await share(owner, hiddenParent, recipient, 'editor');
    await share(owner, file, recipient, 'viewer');
    assert.equal((await api(recipient, 'get', `/items/${file.id}`).expect(200)).body.item.permission, 'editor');
    await api(owner, 'delete', `/items/${hiddenParent.id}/shares/${recipient.user.id}`).expect(204);
    const detail = await api(recipient, 'get', `/items/${file.id}`).expect(200);
    assert.equal(detail.body.item.permission, 'viewer');
    assert.ok(!JSON.stringify(detail.body.breadcrumbs).includes(hiddenParent.name), 'Sharing a child must not expose private ancestor names.');
    await api(recipient, 'get', `/items/${hiddenParent.id}`).expect(404);
    await api(recipient, 'get', '/items').query({ view: 'shared', parentId: hiddenParent.id }).expect(404);
    await versionRequest(recipient, file, 'not allowed anymore').expect(403);
    await api(owner, 'delete', `/items/${file.id}/shares/${recipient.user.id}`).expect(204);
    await api(recipient, 'get', `/items/${file.id}`).expect(404);
    await api(recipient, 'get', `/files/${file.id}/download`).expect(404);
    const shared = await api(recipient, 'get', '/items').query({ view: 'shared' }).expect(200);
    assert.equal(shared.body.total, 0);
  });

  test('version history is immutable; restore adds a version without charging the same blob twice', async () => {
    const owner = await account('History');
    const original = 'the original bytes';
    const replacement = 'a different second version';
    const file = await upload(owner, 'document.txt', original);
    const initial = await api(owner, 'get', `/files/${file.id}/versions`).expect(200);
    assert.equal(initial.body.total, 1);
    const first = initial.body.versions[0];
    assert.equal(first.number, 1);
    assert.equal(first.current, true);
    const update = await versionRequest(owner, file, replacement, file.revision).expect(201);
    assert.ok(update.body.item.revision > file.revision);
    assert.equal((await download(owner, file).expect(200)).body.toString(), replacement);
    const oldDownload = await download(owner, file, first.id).expect(200);
    assert.equal(oldDownload.body.toString(), original);
    assert.match(oldDownload.headers['content-disposition'], /attachment/i);
    assert.equal(await usage(owner), Buffer.byteLength(original) + Buffer.byteLength(replacement));
    const storageBefore = await storedFiles();
    const restored = await api(owner, 'post', `/files/${file.id}/versions/${first.id}/restore`)
      .send({ revision: update.body.item.revision }).expect(200);
    assert.ok(restored.body.item.revision > update.body.item.revision);
    assert.equal((await download(owner, file).expect(200)).body.toString(), original);
    assert.equal(await usage(owner), Buffer.byteLength(original) + Buffer.byteLength(replacement));
    assert.deepEqual(await storedFiles(), storageBefore);
    const history = await api(owner, 'get', `/files/${file.id}/versions`).expect(200);
    assert.deepEqual(history.body.versions.map(version => version.number).sort((a, b) => a - b), [1, 2, 3]);
    assert.equal(history.body.versions.filter(version => version.current).length, 1);
    assert.equal(history.body.versions.find(version => version.current).number, 3);
    const page = await api(owner, 'get', `/files/${file.id}/versions`).query({ page: 2, limit: 1 }).expect(200);
    assert.equal(page.body.total, 3);
    assert.equal(page.body.versions.length, 1);
    assert.equal(page.body.page, 2);
    const other = await upload(owner, 'unrelated.txt', 'unrelated');
    await api(owner, 'get', `/files/${other.id}/download`).query({ versionId: first.id }).expect(404);
    await api(owner, 'post', `/files/${other.id}/versions/${first.id}/restore`).send({}).expect(404);
  });

  test('stale revisions reject metadata and content updates and clean up uploaded bytes', async () => {
    const owner = await account('Revision');
    const file = await upload(owner, 'revision.txt', 'initial');
    const changed = await api(owner, 'patch', `/items/${file.id}`).send({ name: 'new-name.txt', revision: file.revision }).expect(200);
    assert.ok(changed.body.item.revision > file.revision);
    const staleRename = await api(owner, 'patch', `/items/${file.id}`).send({ name: 'lost-update.txt', revision: file.revision });
    assertError(staleRename, 409, 'REVISION_CONFLICT');
    const before = await storedFiles();
    const used = await usage(owner);
    const staleUpload = await versionRequest(owner, file, 'must not be stored', file.revision);
    assertError(staleUpload, 409, 'REVISION_CONFLICT');
    assert.deepEqual(await storedFiles(), before);
    assert.equal(await usage(owner), used);
    assert.equal((await download(owner, file).expect(200)).body.toString(), 'initial');
    assert.equal((await api(owner, 'get', `/files/${file.id}/versions`).expect(200)).body.total, 1);
  });

  test('trashing an ancestor hides inherited and directly shared descendants until restoration', async () => {
    const owner = await account('TrashOwner');
    const viewer = await account('TrashViewer');
    const parent = await folder(owner, 'Deleted project');
    const nested = await folder(owner, 'Nested', parent.id);
    const file = await upload(owner, 'shared.txt', 'retained bytes', nested.id);
    await share(owner, parent, viewer, 'viewer');
    await share(owner, file, viewer, 'viewer');
    const used = await usage(owner);
    await api(owner, 'delete', `/items/${parent.id}`).expect(204);
    for (const url of [`/items/${parent.id}`, `/items/${file.id}`, `/files/${file.id}/download`, `/files/${file.id}/versions`]) {
      await api(viewer, 'get', url).expect(404);
    }
    assert.equal((await api(viewer, 'get', '/items').query({ view: 'shared' }).expect(200)).body.total, 0);
    const trash = await api(owner, 'get', '/items').query({ view: 'trash' }).expect(200);
    assert.ok(trash.body.items.some(item => item.id === parent.id));
    assert.equal(await usage(owner), used, 'Trash retains versions and their quota.');
    await api(owner, 'post', `/items/${parent.id}/restore`).send({}).expect(200);
    assert.equal((await download(viewer, file).expect(200)).body.toString(), 'retained bytes');
  });

  test('restore handles occupied names and requires an active destination', async () => {
    const owner = await account('Restore');
    const first = await folder(owner, 'Occupied');
    await api(owner, 'delete', `/items/${first.id}`).expect(204);
    const duplicate = await folder(owner, 'OCCUPIED');
    await api(owner, 'post', `/items/${first.id}/restore`).send({}).expect(409);
    await api(owner, 'delete', `/items/${duplicate.id}`).expect(204);
    await api(owner, 'post', `/items/${first.id}/restore`).send({}).expect(200);
    const file = await upload(owner, 'child.txt', 'restorable child', first.id);
    await api(owner, 'delete', `/items/${file.id}`).expect(204);
    await api(owner, 'delete', `/items/${first.id}`).expect(204);
    await api(owner, 'post', `/items/${file.id}/restore`).send({}).expect(409);
    const restored = await api(owner, 'post', `/items/${file.id}/restore`).send({ parentId: null }).expect(200);
    assert.equal(restored.body.item.parentId, null);
    assert.equal((await download(owner, file).expect(200)).body.toString(), 'restorable child');
  });

  test('sibling names are case-insensitive across file/folder types and unsafe paths are rejected', async () => {
    const owner = await account('Names');
    await folder(owner, '  Project  ');
    const duplicate = await api(owner, 'post', '/folders').send({ name: 'PROJECT' });
    assertError(duplicate, 409, 'NAME_CONFLICT');
    const before = await storedFiles();
    await uploadRequest(owner, 'project', 'collision').expect(409);
    assert.deepEqual(await storedFiles(), before);
    assert.equal(await usage(owner), 0);
    for (const name of ['', '.', '..', '../escape', 'a/b', 'a\\b', 'nul\u0000byte', 'line\nbreak', 'x'.repeat(201)]) {
      await api(owner, 'post', '/folders').send({ name }).expect(400);
    }
    await folder(owner, 'Caf\u00e9');
    await api(owner, 'post', '/folders').send({ name: 'Cafe\u0301' }).expect(409);
    const another = await folder(owner, 'Another parent');
    await folder(owner, 'Project', another.id);
  });

  test('moves reject cycles and cross-owner destinations and allow valid owner moves', async () => {
    const owner = await account('MoveOwner');
    const other = await account('OtherOwner');
    const parent = await folder(owner, 'Parent');
    const child = await folder(owner, 'Child', parent.id);
    const file = await upload(owner, 'movable.txt', 'move me', parent.id);
    const cycle = await api(owner, 'patch', `/items/${parent.id}`).send({ parentId: child.id });
    assert.ok([400, 409].includes(cycle.status), JSON.stringify(cycle.body));
    const self = await api(owner, 'patch', `/items/${parent.id}`).send({ parentId: parent.id });
    assert.ok([400, 409].includes(self.status), JSON.stringify(self.body));
    const foreign = await folder(other, 'Foreign destination');
    await share(other, foreign, owner, 'editor');
    const crossOwner = await api(owner, 'patch', `/items/${file.id}`).send({ parentId: foreign.id });
    assert.ok([400, 403, 409].includes(crossOwner.status), JSON.stringify(crossOwner.body));
    const moved = await api(owner, 'patch', `/items/${file.id}`).send({ parentId: child.id, revision: file.revision }).expect(200);
    assert.equal(moved.body.item.parentId, child.id);
    assert.equal(moved.body.item.ownerId, owner.user.id);
    const root = await api(owner, 'patch', `/items/${file.id}`).send({ parentId: null, revision: moved.body.item.revision }).expect(200);
    assert.equal(root.body.item.parentId, null);
    const children = await api(owner, 'get', '/items').query({ parentId: child.id }).expect(200);
    assert.equal(children.body.total, 0);
  });

  test('listing pagination, scoped search, and literal search terms are consistent', async () => {
    const owner = await account('Pagination');
    for (const name of ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo']) await folder(owner, name);
    const first = await api(owner, 'get', '/items').query({ page: 1, limit: 2 }).expect(200);
    const second = await api(owner, 'get', '/items').query({ page: 2, limit: 2 }).expect(200);
    assert.equal(first.body.total, 5);
    assert.equal(first.body.page, 1);
    assert.equal(first.body.limit, 2);
    assert.equal(first.body.items.length, 2);
    assert.equal(second.body.total, 5);
    assert.equal(second.body.items.length, 2);
    assert.equal(new Set([...first.body.items, ...second.body.items].map(item => item.id)).size, 4);
    const match = await api(owner, 'get', '/items').query({ q: 'brAVo' }).expect(200);
    assert.equal(match.body.total, 1);
    assert.equal(match.body.items[0].name, 'Bravo');
    await folder(owner, 'Bravo child', match.body.items[0].id);
    assert.equal((await api(owner, 'get', '/items').query({ q: 'Bravo child' }).expect(200)).body.total, 0);
    assert.equal((await api(owner, 'get', '/items').query({ q: '.*' }).expect(200)).body.total, 0);
    assert.equal((await api(owner, 'get', '/items').query({ page: 100, limit: 2 }).expect(200)).body.items.length, 0);
    for (const query of [{ page: 0 }, { page: '1.5' }, { limit: 0 }, { limit: 101 }]) {
      await api(owner, 'get', '/items').query(query).expect(400);
    }
  });

  test('quota rejection is atomic and concurrent uploads cannot overspend the owner quota', async () => {
    const owner = await account('Quota');
    await User.updateOne({ _id: owner.user.id }, { $set: { quotaBytes: 10 } });
    const before = await storedFiles();
    const responses = await Promise.all([
      uploadRequest(owner, 'first.txt', '1234567'),
      uploadRequest(owner, 'second.txt', 'ABCDEFG'),
    ]);
    assert.equal(responses.filter(response => response.status === 201).length, 1, responses.map(r => `${r.status} ${JSON.stringify(r.body)}`).join('\n'));
    const rejected = responses.find(response => response.status !== 201);
    assert.ok([409, 413, 507].includes(rejected.status), JSON.stringify(rejected.body));
    assert.equal(await usage(owner), 7);
    assert.equal(await Blob.countDocuments({ ownerId: owner.user.id }), 1);
    assert.equal(await Item.countDocuments({ ownerId: owner.user.id, kind: 'file' }), 1);
    assert.equal((await storedFiles()).length, before.length + 1);
    const acceptedFile = responses.find(response => response.status === 201).body.item;
    const deniedVersion = await versionRequest(owner, acceptedFile, '1234', acceptedFile.revision);
    assert.ok([409, 413, 507].includes(deniedVersion.status), JSON.stringify(deniedVersion.body));
    assert.equal(await usage(owner), 7);
    assert.equal((await storedFiles()).length, before.length + 1);
    assert.equal(await FileVersion.countDocuments({ fileId: acceptedFile.id }), 1);
  });

  test('concurrent duplicate-name uploads leave one item, one version, and one charged blob', async () => {
    const owner = await account('ConcurrentNames');
    const before = await storedFiles();
    const responses = await Promise.all([
      uploadRequest(owner, 'same.txt', 'same contents'),
      uploadRequest(owner, 'SAME.TXT', 'same contents'),
    ]);
    assert.deepEqual(responses.map(response => response.status).sort(), [201, 409]);
    assert.equal(await usage(owner), Buffer.byteLength('same contents'));
    assert.equal(await Item.countDocuments({ ownerId: owner.user.id }), 1);
    assert.equal(await Blob.countDocuments({ ownerId: owner.user.id }), 1);
    const accepted = responses.find(response => response.status === 201).body.item;
    assert.equal(await FileVersion.countDocuments({ fileId: accepted.id }), 1);
    assert.equal((await storedFiles()).length, before.length + 1);
  });

  test('concurrent owner transactions preserve every successful upload exactly once', async () => {
    const owner = await account('Contention');
    const before = await storedFiles();
    const contents = Array.from({ length: 6 }, (_, index) => `parallel-content-${index}`);
    const responses = await Promise.all(contents.map((content, index) => uploadRequest(owner, `parallel-${index}.txt`, content)));
    for (const response of responses) assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.equal(await usage(owner), contents.reduce((total, content) => total + Buffer.byteLength(content), 0));
    assert.equal(await Item.countDocuments({ ownerId: owner.user.id }), contents.length);
    assert.equal(await Blob.countDocuments({ ownerId: owner.user.id }), contents.length);
    const fileIds = responses.map(response => response.body.item.id);
    assert.equal(await FileVersion.countDocuments({ fileId: { $in: fileIds } }), contents.length);
    assert.equal((await storedFiles()).length, before.length + contents.length);
    for (let index = 0; index < responses.length; index++) {
      const file = responses[index].body.item;
      assert.equal((await download(owner, file).expect(200)).body.toString(), contents[index]);
    }
  });

  test('a transient failure after metadata writes retries without losing bytes or charging twice', async context => {
    const owner = await account('Retry');
    const before = await storedFiles();
    const originalCreate = FileVersion.create;
    let attempts = 0;
    context.mock.method(FileVersion, 'create', async function (...arguments_) {
      const result = await originalCreate.apply(this, arguments_);
      attempts += 1;
      if (attempts === 1) {
        // Throw a real driver error after the version insert. withTransaction
        // must roll that transaction back and execute its callback again.
        const failure = new connection.base.mongo.MongoServerError({
          message: 'Integration fixture: force one transient transaction retry.',
          code: 112,
        });
        failure.addErrorLabel('TransientTransactionError');
        throw failure;
      }
      return result;
    });
    const file = await upload(owner, 'retry.txt', 'retained across transaction retries');
    assert.equal(attempts, 2, 'The transaction callback must actually have retried.');
    assert.equal(await Item.countDocuments({ ownerId: owner.user.id }), 1);
    assert.equal(await Blob.countDocuments({ ownerId: owner.user.id }), 1);
    assert.equal(await FileVersion.countDocuments({ fileId: file.id }), 1);
    assert.equal(await usage(owner), Buffer.byteLength('retained across transaction retries'));
    assert.equal((await storedFiles()).length, before.length + 1);
    assert.equal((await download(owner, file).expect(200)).body.toString(), 'retained across transaction retries');
  });

  test('oversized, malformed, and unauthorized uploads leave no stored files or charged quota', async () => {
    const owner = await account('UploadValidation');
    const before = await storedFiles();
    const oversized = await uploadRequest(owner, 'too-big.txt', Buffer.alloc(UPLOAD_LIMIT + 1));
    assertError(oversized, 413, 'UPLOAD_TOO_LARGE');
    await api(owner, 'post', '/files').field('parentId', '').expect(400);
    await api(owner, 'post', '/files').attach('unexpected', Buffer.from('bad field'), 'bad.txt').expect(400);
    await uploadRequest(owner, 'invalid-parent.txt', 'invalid parent', 'not-an-id').expect(400);
    await request(app).post('/api/files').set('Origin', ORIGIN).attach('file', Buffer.from('anonymous'), 'anonymous.txt').expect(401);
    assert.deepEqual(await storedFiles(), before);
    assert.equal(await usage(owner), 0);
    assert.equal(await Blob.countDocuments({ ownerId: owner.user.id }), 0);
    assert.equal(await Item.countDocuments({ ownerId: owner.user.id }), 0);
  });

  test('missing stored bytes fail cleanly without leaking physical paths or corrupting quota', async () => {
    const owner = await account('MissingBlob');
    const file = await upload(owner, 'missing.txt', 'missing bytes fixture');
    const version = await FileVersion.findOne({ fileId: file.id }).lean();
    const blob = await Blob.findById(version.blobId).lean();
    await unlink(path.join(storageDir, 'blobs', blob.key));
    const response = await api(owner, 'get', `/files/${file.id}/download`);
    assert.ok([404, 410, 503].includes(response.status), JSON.stringify(response.body));
    assert.equal(typeof response.body.error?.message, 'string');
    assert.ok(!JSON.stringify(response.body).includes(storageDir));
    assert.equal(await usage(owner), Buffer.byteLength('missing bytes fixture'));
    const history = await api(owner, 'get', `/files/${file.id}/versions`).expect(200);
    assert.equal(history.body.total, 1);
  });

  test('restoring a missing historical blob fails atomically and keeps the current content usable', async () => {
    const owner = await account('MissingHistory');
    const original = 'historical bytes that will be removed';
    const latest = 'the current bytes remain healthy';
    const file = await upload(owner, 'history-with-loss.txt', original);
    const historicalVersion = await FileVersion.findOne({ fileId: file.id }).lean();
    const historicalBlob = await Blob.findById(historicalVersion.blobId).lean();
    const updated = await versionRequest(owner, file, latest, file.revision).expect(201);
    const currentBefore = await Item.findById(file.id).lean();
    await unlink(path.join(storageDir, 'blobs', historicalBlob.key));
    const response = await api(owner, 'post', `/files/${file.id}/versions/${historicalVersion._id}/restore`)
      .send({ revision: updated.body.item.revision });
    assertError(response, 503, 'FILE_UNAVAILABLE');
    assert.ok(!JSON.stringify(response.body).includes(storageDir));
    const currentAfter = await Item.findById(file.id).lean();
    assert.equal(String(currentAfter.currentVersionId), String(currentBefore.currentVersionId));
    assert.equal(currentAfter.revision, currentBefore.revision);
    assert.equal(currentAfter.versionCount, 2);
    assert.equal(await FileVersion.countDocuments({ fileId: file.id }), 2);
    assert.equal(await usage(owner), Buffer.byteLength(original) + Buffer.byteLength(latest));
    assert.equal((await download(owner, file).expect(200)).body.toString(), latest);
  });

  test('health and OpenAPI documentation are available', async () => {
    await request(app).get('/api/health').expect(200);
    const specification = await request(app).get('/api/openapi.json').expect(200);
    assert.match(specification.body.openapi, /^3\./);
    assert.ok(Object.keys(specification.body.paths).length > 10);
  });
});
