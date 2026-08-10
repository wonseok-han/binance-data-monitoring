import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { DbHandle } from './client.js';
import { createDb } from './client.js';
import { loadConfig } from '../config/env.js';

const currentDir = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = join(currentDir, '../../drizzle');

export function runMigrations({ db }: DbHandle): void {
  migrate(db, { migrationsFolder });
}

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);

if (isMainModule) {
  const config = loadConfig();
  const handle = createDb(config.DATABASE_URL);
  runMigrations(handle);
  handle.sqlite.close();
  console.log(`Migrations applied to ${config.DATABASE_URL}`);
}
