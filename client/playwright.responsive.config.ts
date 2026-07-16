import { defineConfig } from "@playwright/test";
import { e2eClientEnvironment } from "./e2e/environment";

const APP_PORT = 5174;
const API_PORT = 4100;
const APP_URL = `http://127.0.0.1:${APP_PORT}`;
const API_URL = `http://127.0.0.1:${API_PORT}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: /responsive\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI
    ? [["line"], ["html", { outputFolder: "playwright-report", open: "never" }]]
    : [["list"]],
  use: {
    baseURL: APP_URL,
    trace: "on-first-retry",
  },
  webServer: [
    {
      command: "npm run dev:e2e",
      cwd: "../server",
      env: {
        ...process.env,
        PORT: String(API_PORT),
      },
      url: `${API_URL}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `npm run dev:e2e -- --port ${APP_PORT}`,
      env: e2eClientEnvironment(API_URL),
      url: APP_URL,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
  projects: [
    {
      name: "mobile-390",
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
      },
    },
    {
      name: "tablet-portrait-768",
      use: {
        viewport: { width: 768, height: 1024 },
        isMobile: true,
      },
    },
    {
      name: "tablet-landscape-1024",
      use: {
        viewport: { width: 1024, height: 768 },
      },
    },
  ],
});
