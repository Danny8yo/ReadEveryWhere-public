import { defineConfig, devices } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// CSP 回归：生产构建 + 同源反代 + Caddyfile 里的同一条 CSP（见 vite.csp-preview.config.ts）。
// 页面与 /api 同源，因此把 E2E_BACKEND_URL 指向前端，reader.spec.ts 的播种与会话注入原样复用。
const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND_PORT = 3124;
const FRONTEND_PORT = 5190;
const BACKEND_URL = `http://localhost:${BACKEND_PORT}`;
const FRONTEND_URL = `http://localhost:${FRONTEND_PORT}`;

process.env.E2E_BACKEND_URL = FRONTEND_URL;
process.env.E2E_FRONTEND_URL = FRONTEND_URL;

export default defineConfig({
  testDir: './e2e',
  testMatch: ['csp.spec.ts', 'reader.spec.ts'],
  // reader.spec.ts 只取覆盖 EPUB/PDF 打开、翻页与进度的用例，验证 CSP 不误伤阅读器。
  grep: /CSP|阅读器冒烟|边缘翻页交互/,
  grepInvert: /双设备/,
  outputDir: './test-results/csp',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [['list']],
  use: {
    baseURL: FRONTEND_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 30_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', testMatch: 'csp.spec.ts', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: [
    {
      command: 'npm run start:dev',
      cwd: resolve(__dirname, '../backend/myapp'),
      url: `${BACKEND_URL}/api/v1/health`,
      timeout: 120_000,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        PORT: String(BACKEND_PORT),
        LISTEN_HOST: '127.0.0.1',
        NODE_ENV: 'development',
        SQLITE_PATH: 'data/e2e-csp/e2e.sqlite',
        DOWNLOAD_STORAGE_PATH: 'data/e2e-csp/downloads',
        CORS_ORIGIN: FRONTEND_URL,
        JWT_SECRET: 'e2e-csp-secret-not-for-production-use-only-1234567890',
        ENCRYPTION_KEY: randomBytes(32).toString('hex'),
        IMPORT_MAX_FILE_SIZE_MB: '200',
      },
    },
    {
      command: `npx vite build && npx vite preview --config vite.csp-preview.config.ts --port ${FRONTEND_PORT} --strictPort`,
      cwd: __dirname,
      url: FRONTEND_URL,
      timeout: 300_000,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { E2E_CSP_BACKEND_ORIGIN: BACKEND_URL },
    },
  ],
});
