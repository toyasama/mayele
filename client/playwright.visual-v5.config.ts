import { defineConfig, devices } from '@playwright/test'
import { e2eClientEnvironment } from './e2e/environment'

const APP_PORT = 5773
const API_PORT = 4700
const APP_URL = `http://127.0.0.1:${APP_PORT}`
const API_URL = `http://127.0.0.1:${API_PORT}`

process.env.E2E_APP_URL = APP_URL
process.env.E2E_API_URL = API_URL

export default defineConfig({
  testDir: './e2e',
  testMatch: /visual-responsive-safari-v5\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: [['line']],
  use: {
    baseURL: APP_URL,
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
      env: { ...e2eClientEnvironment(API_URL), E2E_DIST_DIR: 'dist-visual-v5' },
      url: APP_URL,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
  projects: [
    {
      name: 'chromium-desktop-1440',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 960 } },
    },
    {
      name: 'chromium-mobile-390',
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
    {
      name: 'chromium-tablet-768',
      use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 }, isMobile: true, hasTouch: true },
    },
    {
      name: 'webkit-desktop-safari',
      use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 960 } },
    },
    {
      name: 'webkit-iphone-safari',
      use: { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } },
    },
    {
      name: 'webkit-ipad-safari',
      use: { ...devices['iPad Mini'], viewport: { width: 768, height: 1024 } },
    },
  ],
})
