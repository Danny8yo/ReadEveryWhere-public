import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './e2e/book-cache', workers: 1, retries: 0,
  use: { baseURL: 'http://127.0.0.1:5196' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['iPhone 13'] } },
  ],
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 5196 --strictPort', url: 'http://127.0.0.1:5196', reuseExistingServer: false },
});
