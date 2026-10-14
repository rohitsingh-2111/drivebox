import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import mongoose from 'mongoose';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { loadConfig } from './config.js';
import { authRouter, requireAuth } from './auth.js';
import { itemsRouter } from './items.js';
import { filesRouter } from './files.js';
import { errorHandler, fail } from './errors.js';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));

export function createApp(options = {}) {
  const config = loadConfig(options.config || {});
  mkdirSync(path.join(config.storageDir, 'blobs'), { recursive: true, mode: 0o700 });
  const app = express();
  app.disable('x-powered-by');
  app.locals.config = config;
  app.use((req, res, next) => {
    req.id = randomUUID();
    res.setHeader('X-Request-Id', req.id);
    next();
  });
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:', 'blob:'], connectSrc: ["'self'"], objectSrc: ["'none'"], upgradeInsecureRequests: config.secureCookies ? [] : null } }, strictTransportSecurity: config.secureCookies ? undefined : false }));
  app.use('/api', cors({ origin: config.clientOrigin, credentials: true }));
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.get('origin');
      if ((origin && origin !== config.clientOrigin) || (!origin && req.get('sec-fetch-site') === 'cross-site')) fail(403, 'INVALID_ORIGIN', 'This request came from an untrusted origin.');
      // Requests without browser Origin/Fetch Metadata (e.g. curl) remain usable.
    }
    next();
  });
  app.use(express.json({ limit: '32kb' }));
  app.get('/api/health', (_req, res) => {
    const connected = mongoose.connection.readyState === 1;
    res.status(connected ? 200 : 503).json({ status: connected ? 'ok' : 'unavailable', database: connected ? 'connected' : 'disconnected' });
  });
  app.get('/api/openapi.json', (_req, res) => {
    const spec = path.join(projectRoot, 'docs', 'openapi.json');
    if (!existsSync(spec)) fail(503, 'SPEC_UNAVAILABLE', 'The API specification is unavailable.');
    res.sendFile(spec);
  });
  app.use('/api/auth', authRouter(config));
  app.use('/api', requireAuth(config), itemsRouter(), filesRouter(config));
  app.use('/api', (_req, _res) => fail(404, 'NOT_FOUND', 'API endpoint not found.'));
  const clientDist = path.join(projectRoot, 'client', 'dist');
  if (existsSync(path.join(clientDist, 'index.html'))) {
    app.use(express.static(clientDist, { index: false, maxAge: config.production ? '1h' : 0 }));
    app.get('/{*path}', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
  }
  app.use((_req, _res) => fail(404, 'NOT_FOUND', 'Page not found.'));
  app.use(errorHandler);
  return app;
}
