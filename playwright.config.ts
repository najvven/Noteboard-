import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { randomUUID } from "node:crypto";

// Every Playwright invocation gets a fresh backend store. Browser contexts are
// isolated per test, but the server writes boards to disk.
const e2eDataDirectory = path.join(process.cwd(), ".tmp", `e2e-data-${randomUUID()}`);

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command:
      "cross-env PORT=3100 NODE_ENV=production node dist/server.cjs",
    env: { NOTEBOARD_DATA_DIR: e2eDataDirectory },
    url: "http://127.0.0.1:3100/api/health",
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chrome",
      use: { ...devices["Desktop Chrome"], channel: "chrome" },
    },
  ],
});
