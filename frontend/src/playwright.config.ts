import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// e2e 专用端口（避开常见的开发端口 3000/5173，防止与已运行的 dev server 冲突）
const BACKEND_PORT = 3123;
const FRONTEND_PORT = 5188;
const BACKEND_URL = `http://localhost:${BACKEND_PORT}`;
const FRONTEND_URL = `http://localhost:${FRONTEND_PORT}`;

// 后端目录（NestJS）。SQLITE_PATH / DOWNLOAD_STORAGE_PATH 相对该 cwd 解析。
const BACKEND_DIR = resolve(__dirname, '../../backend/myapp');

// 供测试用例读取后端地址
process.env.E2E_BACKEND_URL = BACKEND_URL;
process.env.E2E_FRONTEND_URL = FRONTEND_URL;

export default defineConfig({
  testDir: './e2e',
  testIgnore: ['**/selection-qa/**', '**/selection-qa-live/**', '**/book-cache/**', '**/library-sync/**'],
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [['list']],
  use: {
    baseURL: FRONTEND_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // 阅读器下载/解析 EPUB 较慢，放宽单个 action 超时
    actionTimeout: 30_000,
  },
  projects: [
    {
      name: 'mobile-webkit',
      testMatch: '**/reader.spec.ts',
      grep: /手机正文选区笔记|手机目录|原生连续滚动/,
      use: { ...devices['iPhone 13'] },
    },
    {name:'mobile-chromium',testMatch:'**/refactor.spec.ts',use:{...devices['Pixel 7']}},
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      // 后端：独立临时 sqlite + 独立下载目录，避免污染开发库
      command: 'npm run start:dev',
      cwd: BACKEND_DIR,
      url: `${BACKEND_URL}/api/v1/health`,
      timeout: 120_000,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        PORT: String(BACKEND_PORT),
        LISTEN_HOST: '127.0.0.1',
        NODE_ENV: 'development',
        // e2e 专用临时库/存储（相对 backend/myapp；已被 .gitignore 覆盖）
        SQLITE_PATH: 'data/e2e/e2e.sqlite',
        DOWNLOAD_STORAGE_PATH: 'data/e2e/downloads',
        CORS_ORIGIN: `${FRONTEND_URL},${BACKEND_URL}`,
        JWT_SECRET: 'e2e-test-secret-not-for-production-use-only-1234567890',
        ENCRYPTION_KEY: '3d07e19bdced92848c1b57ebc8d4408eb95ce5647a2c36b26a1e6abfa3fe157f',
        IMPORT_MAX_FILE_SIZE_MB: '200',
      },
    },
    {
      // 前端：固定端口 + strictPort，避免 Vite 自动跳端口导致 baseURL 不一致
      command: `npm run dev -- --port ${FRONTEND_PORT} --strictPort`,
      cwd: __dirname,
      url: FRONTEND_URL,
      timeout: 120_000,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
