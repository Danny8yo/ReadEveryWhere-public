import { defineConfig } from '@playwright/test';

// 封面流视觉重构的截图对照（docs/封面流视觉重构计划.md 第 3.2 节）。只起前端，接口全部在用例里模拟。
const FRONTEND_PORT = 5189;

export default defineConfig({
  testDir: './e2e/cover-flow',
  // 独立的输出目录：默认的 test-results/ 会在每次运行时被清空，和主 e2e 互相删
  outputDir: './visual-shots/.playwright',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 240_000,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${FRONTEND_PORT}`, actionTimeout: 15_000 },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: `npm run dev -- --port ${FRONTEND_PORT} --strictPort`,
    url: `http://localhost:${FRONTEND_PORT}`,
    timeout: 120_000,
    reuseExistingServer: false,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
