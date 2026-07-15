import { defineConfig, devices } from '@playwright/test'

const APP_PORT = 5175
const API_PORT = 4101
const APP_URL = `http://127.0.0.1:${APP_PORT}`
const API_URL = `http://127.0.0.1:${API_PORT}`

export default defineConfig({
  testDir: './e2e',
  testMatch: /visual-desktop\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: APP_URL,
    trace: 'on-first-retry',
  },
  webServer: [
    {
      command: 'npm run dev:e2e',
      cwd: '../server',
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
      env: {
        ...process.env,
        VITE_API_URL: `${API_URL}/api`,
        VITE_REALTIME_URL: API_URL,
        VITE_E2E_AUTH_BYPASS: 'true',
      },
      url: APP_URL,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
  projects: [
    {
      name: 'windows-chromium-1440',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 960 },
      },
    },
    {
      name: 'windows-firefox-1440',
      use: {
        ...devices['Desktop Firefox'],
        viewport: { width: 1440, height: 960 },
      },
    },
    {
      name: 'safari-webkit-2048',
      use: {
        ...devices['Desktop Safari'],
        viewport: { width: 2048, height: 1536 },
      },
    },
  ],
})
