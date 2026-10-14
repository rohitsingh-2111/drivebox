import test from 'node:test';
import assert from 'node:assert/strict';
import { api, ApiError } from '../client/src/api.js';

test('JSON mutations send session cookies, encode JSON and preserve explicit methods', async t => {
  let observed;
  t.mock.method(globalThis, 'fetch', async (...args) => {
    observed = args;
    return new Response(JSON.stringify({ item: { id: 'test' } }), { status: 201 });
  });
  const response = await api('/folders', { method: 'POST', body: { name: 'Project' } });
  assert.equal(response.item.id, 'test');
  assert.equal(observed[0], '/api/folders');
  assert.equal(observed[1].method, 'POST');
  assert.equal(observed[1].credentials, 'include');
  assert.equal(observed[1].headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(observed[1].body), { name: 'Project' });
});

test('multipart uploads preserve browser-generated boundary and no-content responses work', async t => {
  const form = new FormData();
  form.append('file', new Blob(['contents']), 'notes.txt');
  t.mock.method(globalThis, 'fetch', async (_path, options) => {
    assert.equal(options.body, form);
    assert.equal(options.headers['Content-Type'], undefined);
    assert.equal(options.credentials, 'include');
    return new Response(null, { status: 204 });
  });
  assert.equal(await api('/files', { method: 'POST', body: form }), null);
});

test('conflicts preserve server status, error code and actionable details', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    error: { code: 'REVISION_CONFLICT', message: 'Refresh and try again.', details: { revision: 4 } },
  }), { status: 409 }));
  await assert.rejects(api('/items/example', { method: 'PATCH', body: { name: 'New' } }), error => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 409);
    assert.equal(error.code, 'REVISION_CONFLICT');
    assert.equal(error.message, 'Refresh and try again.');
    assert.deepEqual(error.details, { revision: 4 });
    return true;
  });
});

test('offline failures are readable while cancellation remains distinguishable', async t => {
  const mock = t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('fetch failed'); });
  await assert.rejects(api('/items'), { code: 'NETWORK_ERROR', status: 0 });
  mock.mock.mockImplementation(async () => { throw new DOMException('Aborted', 'AbortError'); });
  await assert.rejects(api('/items'), { name: 'AbortError' });
});
