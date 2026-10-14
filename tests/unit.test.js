import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeName, normalizeEmail, objectId, pagination, revisionNumber,
  checkRevision, searchTerm, escapeRegex, safeMime, fields,
} from '../server/src/validation.js';
import { hashPassword, verifyPassword, validatePassword, newSessionToken, hashToken } from '../server/src/crypto.js';
import { loadConfig } from '../server/src/config.js';

test('names normalize whitespace, Unicode and case for collision detection', () => {
  assert.deepEqual(normalizeName('  Re\u0301sume\u0301.PDF  '), { name: 'Résumé.PDF', nameKey: 'résumé.pdf' });
  assert.equal(normalizeName('REPORT.txt').nameKey, normalizeName('report.TXT').nameKey);
});

test('names reject traversal, separators, control characters and non-string payloads', () => {
  for (const name of ['', '  ', '.', '..', '../report', 'a/b', 'a\\b', 'a\0b', 'a\nb', 'a\rb', '\u007f', 'x'.repeat(201), null, 5, { $gt: '' }]) {
    assert.throws(() => normalizeName(name), { code: 'VALIDATION_ERROR' });
  }
});

test('email normalization is stable and rejects injection-shaped values', () => {
  assert.equal(normalizeEmail('  USER@Example.COM '), 'user@example.com');
  for (const value of ['bad', 'a@b', 'a b@example.com', '', null, { $ne: null }]) assert.throws(() => normalizeEmail(value));
});

test('item identifiers only accept 24-character hexadecimal scalar strings', () => {
  const id = '0123456789abcdef01234567';
  assert.equal(objectId(id), id);
  assert.equal(objectId(null, { nullable: true }), null);
  for (const value of ['../etc/passwd', 'x'.repeat(24), '', 4, null, { $ne: null }]) assert.throws(() => objectId(value));
});

test('pagination bounds prevent unbounded and invalid queries', () => {
  assert.deepEqual(pagination({}), { page: 1, limit: 20, skip: 0 });
  assert.deepEqual(pagination({ page: '3', limit: '10' }), { page: 3, limit: 10, skip: 20 });
  for (const query of [{ page: 0 }, { page: -1 }, { page: 'NaN' }, { page: 1.5 }, { limit: 101 }, { limit: 0 }, { page: Infinity }]) assert.throws(() => pagination(query));
});

test('stale revisions report conflict rather than overwriting', () => {
  assert.equal(revisionNumber('2'), 2);
  assert.equal(revisionNumber(undefined), undefined);
  checkRevision({ revision: 2 }, 2);
  assert.throws(() => checkRevision({ revision: 3 }, 2), { code: 'REVISION_CONFLICT' });
  for (const value of [0, -1, 1.2, 'nope']) assert.throws(() => revisionNumber(value));
});

test('search metacharacters are literal and bounded', () => {
  const input = 'file[1].*(draft)+?$^{}|\\';
  assert.equal(new RegExp(`^${escapeRegex(input)}$`).test(input), true);
  assert.equal(searchTerm(' Report '), 'Report');
  assert.throws(() => searchTerm('x'.repeat(201)));
  assert.throws(() => searchTerm({ $regex: '.*' }));
});

test('MIME values cannot inject headers and have a safe fallback', () => {
  assert.equal(safeMime('text/plain'), 'text/plain');
  assert.equal(safeMime('application/vnd.example+json'), 'application/vnd.example+json');
  for (const value of ['text/plain\r\nX-Injected: yes', 'bad', null, {}]) assert.equal(safeMime(value), 'application/octet-stream');
});

test('request bodies cannot inject owner/quota fields', () => {
  fields({ name: 'New name' }, ['name']);
  for (const body of [{ ownerId: 'someone' }, { usedBytes: -1 }, null, [], 'name']) assert.throws(() => fields(body, ['name']));
});

test('password policy enforces bounded, non-coerced input', () => {
  validatePassword('A-valid-long-password');
  for (const value of ['short', 'x'.repeat(129), null, 1234567890, ['long-enough-password']]) assert.throws(() => validatePassword(value));
});

test('passwords are salted and verify correctly without storing plaintext', async () => {
  const password = 'My-example-password-123!';
  const [a, b] = await Promise.all([hashPassword(password), hashPassword(password)]);
  assert.notEqual(a, b);
  assert.equal(a.includes(password), false);
  assert.equal(await verifyPassword(password, a), true);
  assert.equal(await verifyPassword('Incorrect-password', a), false);
  assert.equal(await verifyPassword(null, a), false);
});

test('session tokens are random and stored as keyed hashes', () => {
  const a = newSessionToken();
  const b = newSessionToken();
  assert.notEqual(a, b);
  assert.equal(Buffer.from(a, 'base64url').length, 32);
  assert.notEqual(hashToken(a, 'one-secret'), hashToken(a, 'another-secret'));
  assert.notEqual(hashToken(a, 'one-secret'), a);
  assert.equal(hashToken(a, 'one-secret').length, 64);
});

test('configuration rejects weak session secrets and unsafe origin forms', () => {
  assert.throws(() => loadConfig({ sessionSecret: 'short' }));
  for (const origin of ['https://example.com/', 'https://example.com/path', 'file:///tmp/a', 'null']) {
    assert.throws(() => loadConfig({ sessionSecret: 'x'.repeat(48), clientOrigin: origin }));
  }
});

test('cookie Secure flag follows configured HTTPS deployment origin', () => {
  const secret = 'unit-test-only-secret-with-more-than-32-chars';
  assert.equal(loadConfig({ sessionSecret: secret, clientOrigin: 'https://example.com' }).secureCookies, true);
  assert.equal(loadConfig({ sessionSecret: secret, clientOrigin: 'http://localhost:4000' }).secureCookies, false);
});
