import { defineConfig, devices } from '@playwright/test'
import { e2eClientEnvironment } from './e2e/environment'

const APP_PORT = Number(process.env.PLAYWRIGHT_APP_PORT ?? 5673)
const API_PORT = Number(process.env.PLAYWRIGHT_API_PORT ?? 4600)
const APP_URL = `http://127.0.0.1:${APP_PORT}`
const API_URL = `http://127.0.0.1:${API_PORT}`

process.env.E2E_APP_URL = APP_URL
process.env.E2E_API_URL = API_URL

export default defineConfig({
  testDir: './e2e',
  testMatch: /(architecture-visual|session-idempotency|xp-outbox)\.spec\.ts/,
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
      env: { ...e2eClientEnvironment(API_URL), E2E_DIST_DIR: 'dist-architecture' },
      url: APP_URL,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})
