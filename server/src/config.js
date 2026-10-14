import path from 'node:path';

function positiveInteger(value, fallback, name) {
  const result = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(result) || result < 1) throw new Error(`${name} must be a positive integer.`);
  return result;
}

export function loadConfig(overrides = {}) {
  const production = process.env.NODE_ENV === 'production';
  const config = {
    production,
    port: positiveInteger(process.env.PORT, 4000, 'PORT'),
    mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/drivebox?replicaSet=rs0',
    clientOrigin: process.env.CLIENT_ORIGIN || process.env.APP_ORIGIN || 'http://localhost:5173',
    storageDir: path.resolve(process.env.STORAGE_DIR || './storage'),
    sessionSecret: process.env.SESSION_SECRET || (production ? '' : 'development-only-change-this-secret-before-deploying'),
    sessionDays: positiveInteger(process.env.SESSION_DAYS, 7, 'SESSION_DAYS'),
    quotaBytes: positiveInteger(process.env.DEFAULT_QUOTA_BYTES, 100 * 1024 * 1024, 'DEFAULT_QUOTA_BYTES'),
    maxUploadBytes: positiveInteger(process.env.MAX_UPLOAD_BYTES, 25 * 1024 * 1024, 'MAX_UPLOAD_BYTES'),
    cookieName: 'drivebox_session',
    ...overrides,
  };
  if (typeof config.sessionSecret !== 'string' || config.sessionSecret.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters.');
  const origin = new URL(config.clientOrigin);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== config.clientOrigin) throw new Error('CLIENT_ORIGIN must be an HTTP(S) origin without a trailing slash.');
  config.storageDir = path.resolve(config.storageDir);
  // Local Docker HTTP remains usable; TLS deployments automatically use Secure cookies.
  config.secureCookies = origin.protocol === 'https:';
  return config;
}
