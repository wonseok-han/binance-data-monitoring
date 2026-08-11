import { loadRuntimeConfig, loadServerEnv } from '../config/index.js';
import { createDb } from '../db/client.js';
import { resumeFailedBackfillJob } from '../db/backfillJobs.js';

const symbol = process.argv[2]?.trim().toUpperCase();

if (!symbol) {
  console.error('사용법: pnpm --filter @binance-monitoring/server run backfill:resume -- <SYMBOL>');
  process.exit(1);
}

loadServerEnv();
const config = loadRuntimeConfig();
const dbHandle = createDb(config.DATABASE_URL);

const result = resumeFailedBackfillJob(dbHandle.db, symbol, Date.now());
dbHandle.sqlite.close();

if (!result) {
  console.error(`${symbol}에 대해 failed 상태인 backfill job이 없습니다.`);
  process.exit(1);
}

console.log(
  `backfill job #${result.id}(${symbol})을 pending으로 재개했습니다. 서버를 재시작하면 저장된 cursor부터 이어서 처리됩니다.`,
);
