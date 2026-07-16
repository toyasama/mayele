import { defineConfig, devices } from "@playwright/test";
import { e2eClientEnvironment } from "./e2e/environment";

export default defineConfig({
  testDir: "./e2e",
  testIgnore: ["**/responsive.spec.ts", "**/visual-desktop.spec.ts"],
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI
    ? [["line"], ["html", { outputFolder: "playwright-report", open: "never" }]]
    : [["list"]],
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "on-first-retry",
  },
  webServer: [
    {
      command: "npm run serve:e2e -- --port 5173",
      cwd: "../server",
      url: "http://127.0.0.1:4000/api/health",
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "npm run dev:e2e",
      env: e2eClientEnvironment("http://127.0.0.1:4000"),
      url: "http://127.0.0.1:5173",
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
