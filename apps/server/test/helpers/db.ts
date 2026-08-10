import type { DbHandle } from '../../src/db/client.js';
import { createDb } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';

export function createTestDb(): DbHandle {
  const handle = createDb(':memory:');
  runMigrations(handle);
  return handle;
}
