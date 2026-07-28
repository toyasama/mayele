import { defineConfig, devices } from '@playwright/test'
import { e2eClientEnvironment } from './e2e/environment'

const APP_PORT = 5577
const API_PORT = 4501
const APP_URL = `http://127.0.0.1:${APP_PORT}`
const API_URL = `http://127.0.0.1:${API_PORT}`

export default defineConfig({
  testDir: './e2e',
  testMatch: /realtime-bootstrap\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  reporter: [['line']],
  use: {
    baseURL: APP_URL,
    ...devices['Desktop Chrome'],
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'npm run dev:e2e',
      cwd: '../server',
      env: { ...process.env, PORT: String(API_PORT) },
      url: `${API_URL}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `npm run serve:e2e -- --port ${APP_PORT}`,
      env: { ...e2eClientEnvironment(API_URL), E2E_DIST_DIR: 'dist-realtime-bootstrap' },
      url: APP_URL,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})
