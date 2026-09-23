import { defineConfig, devices } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const runDir =
  process.env.QA_BROWSER_RUN_DIR ??
  mkdtempSync(join(tmpdir(), "rew-qa-browser-"));
process.env.QA_BROWSER_RUN_DIR = runDir;
process.env.QA_BROWSER_DESCRIPTOR = join(runDir, "server.json");
const backendUrl = "http://127.0.0.1:3184",
  frontendUrl = "http://127.0.0.1:5194";
const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
export default defineConfig({
  testDir: "./e2e/selection-qa",
  testMatch: "**/*.spec.ts",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 120000,
  expect: { timeout: 20000 },
  reporter: [["list"], ["json", { outputFile: join(runDir, "results.json") }]],
  outputDir: join(runDir, "artifacts"),
  use: {
    baseURL: frontendUrl,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 30000,
  },
  projects: [
    { name: "qa-desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "qa-mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: [
    {
      command: `${quote(process.execPath)} -r ts-node/register/transpile-only test/selection-qa/server.ts`,
      cwd: resolve(here, "../../backend/myapp"),
      url: backendUrl + "/api/v1/health",
      reuseExistingServer: false,
      timeout: 120000,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        QA_TEST_PORT: "3184",
        QA_FRONTEND_ORIGIN: frontendUrl,
        QA_TEST_DESCRIPTOR: process.env.QA_BROWSER_DESCRIPTOR,
      },
    },
    {
      command: `${quote(process.execPath)} ${quote(resolve(here, "node_modules/vite/bin/vite.js"))} --host 127.0.0.1 --port 5194 --strictPort`,
      cwd: here,
      url: frontendUrl,
      reuseExistingServer: false,
      timeout: 120000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
