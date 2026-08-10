import 'dotenv/config';
import { loadConfig } from './config.js';
import { createDb } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { buildApp } from './http/app.js';

const config = loadConfig();
const dbHandle = createDb(config.DATABASE_URL);
runMigrations(dbHandle);

const app = buildApp({ db: dbHandle, config });

await app.listen({ port: config.PORT, host: '0.0.0.0' });
