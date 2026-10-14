import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { connectDatabase, disconnectDatabase } from './db.js';

const envFile = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);
const config = loadConfig();

try {
  await connectDatabase(config.mongoUri);
  const app = createApp({ config });
  const server = app.listen(config.port, '0.0.0.0', () => console.log(`Drivebox is listening on http://localhost:${config.port}`));
  server.requestTimeout = 120000;
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('Closing HTTP server and database connection…');
    server.close(async () => { await disconnectDatabase(); process.exit(0); });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
} catch (error) {
  console.error(`Startup failed: ${error.message}`);
  await disconnectDatabase();
  process.exit(1);
}
