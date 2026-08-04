import { defineConfig, devices } from "@playwright/test";
import { e2eClientEnvironment } from "./e2e/environment";

const APP_PORT = Number(process.env.PLAYWRIGHT_APP_PORT ?? 5173);
const API_PORT = Number(process.env.PLAYWRIGHT_API_PORT ?? 4000);
const APP_URL = `http://127.0.0.1:${APP_PORT}`;
const API_URL = `http://127.0.0.1:${API_PORT}`;

process.env.E2E_APP_URL = APP_URL;
process.env.E2E_API_URL = API_URL;

export default defineConfig({
  testDir: "./e2e",
  testIgnore: [
    "**/performance.spec.ts",
    "**/responsive.spec.ts",
    "**/visual-desktop.spec.ts",
    "**/visual-responsive-safari-v5.spec.ts",
  ],
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["github"], ["line"], ["html", { outputFolder: "playwright-report", open: "never" }]]
    : [["list"]],
  use: {
    baseURL: APP_URL,
    trace: "on-first-retry",
  },
  webServer: [
    {
      command: "npm run dev:e2e",
      cwd: "../server",
      env: { ...process.env, PORT: String(API_PORT) },
      url: `${API_URL}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `npm run serve:e2e -- --port ${APP_PORT}`,
      env: { ...e2eClientEnvironment(API_URL), E2E_DIST_DIR: 'dist-e2e' },
      url: APP_URL,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
