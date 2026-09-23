import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
for (const key of ['QA_LIVE_URL', 'QA_LIVE_BACKEND_URL', 'QA_LIVE_EMAIL', 'QA_LIVE_PASSWORD', 'QA_LIVE_BOOK']) {
  if (!process.env[key]) throw new Error(`真实 LLM 验收缺少 ${key}，请通过本地环境变量提供；会产生 API 费用。`);
}
for (const key of ['QA_LIVE_URL', 'QA_LIVE_BACKEND_URL']) {
  const url = new URL(process.env[key]!);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('真实验收仅允许本机服务');
}
const runDir = process.env.QA_LIVE_RUN_DIR ?? mkdtempSync(join(tmpdir(), 'rew-qa-live-'));
mkdirSync(runDir, { recursive: true, mode: 0o700 });
process.env.QA_LIVE_RUN_DIR = runDir;
export default defineConfig({
  testDir: './e2e/selection-qa-live', workers: 1, fullyParallel: false, retries: 0, maxFailures: 1,
  timeout: 600000, expect: { timeout: 20000 },
  reporter: [['list']], outputDir: join(runDir, 'artifacts'),
  use: { baseURL: process.env.QA_LIVE_URL, ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1050 }, actionTimeout: 20000, trace: 'off', video: 'off', screenshot: 'off' },
});
