import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';

const SERVER_ENV_PATH = fileURLToPath(new URL('../../.env', import.meta.url));

/** 모든 서버 진입점이 실행 위치와 무관하게 apps/server/.env를 읽는다. */
export function loadServerEnv(
  target: NodeJS.ProcessEnv = process.env,
  path: string = SERVER_ENV_PATH,
): void {
  loadDotenv({ path, processEnv: target, quiet: true });
}
