import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { loadServerEnv } from './serverEnv.js';

let testDir: string | null = null;

afterEach(() => {
  if (testDir) rmSync(testDir, { recursive: true, force: true });
  testDir = null;
});

describe('loadServerEnv', () => {
  it('loads values into the provided environment regardless of the process cwd', () => {
    testDir = mkdtempSync(join(tmpdir(), 'binance-server-env-'));
    const envPath = join(testDir, '.env');
    writeFileSync(envPath, 'PORT=4321\nDATABASE_URL=./data/custom.db\n');
    const target: NodeJS.ProcessEnv = {};

    loadServerEnv(target, envPath);

    expect(target.PORT).toBe('4321');
    expect(target.DATABASE_URL).toBe('./data/custom.db');
  });

  it('does not overwrite values already provided by the runtime environment', () => {
    testDir = mkdtempSync(join(tmpdir(), 'binance-server-env-'));
    const envPath = join(testDir, '.env');
    writeFileSync(envPath, 'PORT=4321\n');
    const target: NodeJS.ProcessEnv = { PORT: '5000' };

    loadServerEnv(target, envPath);

    expect(target.PORT).toBe('5000');
  });
});
