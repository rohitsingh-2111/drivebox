import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { User, Session } from './models.js';
import { publicUser } from './access.js';
import { fields, normalizeEmail } from './validation.js';
import { fail } from './errors.js';
import { hashPassword, verifyPassword, validatePassword, newSessionToken, hashToken } from './crypto.js';

export function cookieOptions(config) {
  return { httpOnly: true, secure: config.secureCookies, sameSite: 'lax', path: '/api', maxAge: config.sessionDays * 86400000 };
}

export function readSessionToken(req, config) {
  const value = req.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(`${config.cookieName}=`))?.slice(config.cookieName.length + 1);
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}

export function requireAuth(config) {
  return async (req, _res, next) => {
    const token = readSessionToken(req, config);
    if (!token) fail(401, 'UNAUTHENTICATED', 'Please sign in to continue.');
    const session = await Session.findOne({ tokenHash: hashToken(token, config.sessionSecret), expiresAt: { $gt: new Date() } }).lean();
    if (!session) fail(401, 'UNAUTHENTICATED', 'Your session expired. Please sign in again.');
    const user = await User.findById(session.userId).lean();
    if (!user) fail(401, 'UNAUTHENTICATED', 'Please sign in to continue.');
    req.user = user;
    req.authSession = session;
    next();
  };
}

async function createSession(req, res, user, config) {
  const old = readSessionToken(req, config);
  if (old) await Session.deleteOne({ tokenHash: hashToken(old, config.sessionSecret) });
  const token = newSessionToken();
  await Session.create({ tokenHash: hashToken(token, config.sessionSecret), userId: user._id, expiresAt: new Date(Date.now() + config.sessionDays * 86400000) });
  res.cookie(config.cookieName, token, cookieOptions(config));
}

export function authRouter(config) {
  const router = Router();
  const authLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: config.authRateLimit ?? 40, standardHeaders: 'draft-8', legacyHeaders: false, handler: (_req, res) => res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please try again in 15 minutes.' } }) });
  // Equal-cost comparison for unknown users reduces email timing differences.
  const dummyHash = hashPassword('unusable-random-dummy-password');

  router.post('/register', authLimit, async (req, res) => {
    fields(req.body, ['name', 'email', 'password']);
    const email = normalizeEmail(req.body.email);
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    if (!name || name.length > 100 || /[\u0000-\u001f\u007f]/u.test(name)) fail(400, 'VALIDATION_ERROR', 'Name must contain 1–100 characters.');
    validatePassword(req.body.password);
    const passwordHash = await hashPassword(req.body.password);
    const user = await User.create({ name, email, passwordHash, quotaBytes: config.quotaBytes });
    await createSession(req, res, user, config);
    res.status(201).json({ user: publicUser(user) });
  });

  router.post('/login', authLimit, async (req, res) => {
    fields(req.body, ['email', 'password']);
    const email = normalizeEmail(req.body.email);
    const user = await User.findOne({ email }).select('+passwordHash').lean();
    const valid = await verifyPassword(req.body.password, user?.passwordHash || await dummyHash);
    if (!user || !valid) fail(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    await createSession(req, res, user, config);
    res.json({ user: publicUser(user) });
  });

  router.post('/logout', async (req, res) => {
    const token = readSessionToken(req, config);
    if (token) await Session.deleteOne({ tokenHash: hashToken(token, config.sessionSecret) });
    const { maxAge, ...clearOptions } = cookieOptions(config);
    res.clearCookie(config.cookieName, clearOptions);
    res.status(204).end();
  });

  router.get('/me', requireAuth(config), async (req, res) => res.json({ user: publicUser(req.user) }));
  return router;
}
