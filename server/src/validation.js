import { fail } from './errors.js';

export function normalizeName(input) {
  if (typeof input !== 'string') fail(400, 'VALIDATION_ERROR', 'A name is required.');
  const name = input.normalize('NFC').trim();
  if (!name || name.length > 200 || name === '.' || name === '..' || /[/\\\u0000-\u001f\u007f]/u.test(name)) {
    fail(400, 'VALIDATION_ERROR', 'Names must contain 1–200 characters and cannot contain slashes or control characters.');
  }
  return { name, nameKey: name.toLocaleLowerCase('en-US') };
}

export function normalizeEmail(value) {
  if (typeof value !== 'string') fail(400, 'VALIDATION_ERROR', 'Enter a valid email address.');
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) fail(400, 'VALIDATION_ERROR', 'Enter a valid email address.');
  return email;
}

export function objectId(value, { nullable = false } = {}) {
  if (nullable && (value === null || value === undefined || value === '')) return null;
  if (typeof value !== 'string' || !/^[a-f0-9]{24}$/i.test(value)) fail(400, 'VALIDATION_ERROR', 'Invalid item identifier.');
  return value;
}

export function pagination(query) {
  const page = Number(query.page ?? 1);
  const limit = Number(query.limit ?? 20);
  if (!Number.isSafeInteger(page) || page < 1 || page > 1000000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    fail(400, 'VALIDATION_ERROR', 'Page must be a positive integer and limit must be between 1 and 100.');
  }
  return { page, limit, skip: (page - 1) * limit };
}

export function revisionNumber(value) {
  if (value === undefined || value === '') return undefined;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) fail(400, 'VALIDATION_ERROR', 'Revision must be a positive integer.');
  return number;
}

export function checkRevision(item, value) {
  const revision = revisionNumber(value);
  if (revision !== undefined && item.revision !== revision) fail(409, 'REVISION_CONFLICT', 'This item changed. Refresh and try again.');
}

export function searchTerm(value) {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.length > 200) fail(400, 'VALIDATION_ERROR', 'Search must contain at most 200 characters.');
  return value.trim().normalize('NFC');
}

export function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function safeMime(value) {
  return typeof value === 'string' && /^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/.test(value) ? value : 'application/octet-stream';
}

export function fields(body, allowed) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'VALIDATION_ERROR', 'An object request body is required.');
  const unexpected = Object.keys(body).filter(key => !allowed.includes(key));
  if (unexpected.length) fail(400, 'VALIDATION_ERROR', `Unexpected fields: ${unexpected.join(', ')}.`);
}
