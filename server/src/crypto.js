import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHmac } from 'node:crypto';
import { promisify } from 'node:util';
import { fail } from './errors.js';

const scrypt = promisify(scryptCallback);
const parameters = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 10 || password.length > 128) fail(400, 'VALIDATION_ERROR', 'Password must contain 10–128 characters.');
}

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64, parameters);
  return `scrypt$${salt}$${key.toString('hex')}`;
}

export async function verifyPassword(password, hash) {
  if (typeof password !== 'string' || password.length > 128) return false;
  const [, salt, stored] = hash.split('$');
  const expected = Buffer.from(stored, 'hex');
  const actual = await scrypt(password, salt, 64, parameters);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export const newSessionToken = () => randomBytes(32).toString('base64url');
export const hashToken = (token, secret) => createHmac('sha256', secret).update(token).digest('hex');
