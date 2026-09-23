import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendDir = fileURLToPath(new URL('.', import.meta.url));
const runRoot = mkdtempSync(join(tmpdir(), 'rew-library-sync-'));
const backend = 'http://127.0.0.1:3137';
const frontend = 'http://127.0.0.1:5197';
process.env.LIBRARY_SYNC_BACKEND = backend;
process.env.LIBRARY_SYNC_FRONTEND = frontend;
export default defineConfig({
  testDir: './e2e/library-sync', workers: 1, fullyParallel: false,
  retries: 0, timeout: 120_000, expect: { timeout: 10_000 },
  reporter: [['list']], outputDir: join(runRoot, 'artifacts'),
  use: { baseURL: frontend, trace: 'off', screenshot: 'off', video: 'off' },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
    { name: 'mobile-webkit', use: { ...devices['iPhone 13'] } },
  ],
  webServer: [
    {
      command: 'node -r ts-node/register/transpile-only src/main.ts',
      cwd: resolve(frontendDir, '../../backend/myapp'),
      url: `${backend}/api/v1/health`, reuseExistingServer: false, timeout: 120_000,
      env: {
        PORT: '3137', LISTEN_HOST: '127.0.0.1', NODE_ENV: 'test',
        DEV_SEED_ACCOUNT: 'false', REGISTRATION_ENABLED: 'true',
        SQLITE_PATH: join(runRoot, 'database.sqlite'), DOWNLOAD_STORAGE_PATH: join(runRoot, 'downloads'),
        CORS_ORIGIN: `${frontend},${backend}`, LOG_LEVEL: 'error',
        JWT_SECRET: 'isolated-library-sync-test-secret-only-1234567890',
        ENCRYPTION_KEY: '3d07e19bdced92848c1b57ebc8d4408eb95ce5647a2c36b26a1e6abfa3fe157f',
      },
    },
    { command: 'npm run dev -- --host 127.0.0.1 --port 5197 --strictPort', cwd: frontendDir,
      url: frontend, reuseExistingServer: false },
  ],
});
