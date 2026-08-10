import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';

export interface DbHandle {
  db: ReturnType<typeof drizzle<typeof schema>>;
  sqlite: Database.Database;
}

export function createDb(databaseUrl: string): DbHandle {
  if (databaseUrl !== ':memory:') {
    mkdirSync(dirname(databaseUrl), { recursive: true });
  }

  const sqlite = new Database(databaseUrl);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  return { db: drizzle(sqlite, { schema }), sqlite };
}
