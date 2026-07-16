import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from '@playwright/test'

const rawAppUrl = process.env.PRODUCTION_APP_URL

if (!rawAppUrl) {
  throw new Error('PRODUCTION_APP_URL doit etre defini.')
}

const appUrl = new URL(rawAppUrl)
if (appUrl.protocol !== 'https:') {
  throw new Error('PRODUCTION_APP_URL doit utiliser HTTPS.')
}

const maxAttempts = Number(process.env.PRODUCTION_SMOKE_ATTEMPTS ?? 6)
const retryDelayMs = Number(process.env.PRODUCTION_SMOKE_RETRY_DELAY_MS ?? 5_000)
const outputDirectory = resolve(process.cwd(), 'test-results', 'production-smoke')
const screenshotPath = resolve(outputDirectory, 'dashboard.png')

await mkdir(outputDirectory, { recursive: true })

const browser = await chromium.launch({ headless: true })
let smokePassed = false
let lastFailure = 'Le rendu de production n a pas ete verifie.'

try {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    const pageErrors = []
    page.on('pageerror', (error) => pageErrors.push(error.message))

    try {
      const target = new URL('/dashboard', appUrl)
      target.searchParams.set('production-smoke', `${Date.now()}-${attempt}`)
      const response = await page.goto(target.toString(), { waitUntil: 'networkidle', timeout: 30_000 })

      await page.waitForFunction(() => {
        const root = document.getElementById('root')
        return Boolean(root && root.childElementCount > 0 && root.textContent?.trim())
      }, { timeout: 15_000 })

      await page.screenshot({ path: screenshotPath, fullPage: true })

      if (await page.locator('.app-bootstrap-error').isVisible()) {
        throw new Error('La configuration frontend est absente ou invalide.')
      }

      if (pageErrors.length > 0) {
        throw new Error(`Erreur JavaScript: ${pageErrors.join(' | ')}`)
      }

      if (!response?.ok()) {
        throw new Error(`Reponse HTTP inattendue: ${response?.status() ?? 'sans reponse'}`)
      }

      console.log(`Smoke production OK: ${page.url()}`)
      smokePassed = true
      break
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error)
      await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined)
    } finally {
      await page.close()
    }

    if (attempt < maxAttempts) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, retryDelayMs))
    }
  }
} finally {
  await browser.close()
}

if (!smokePassed) {
  throw new Error(`Smoke production en echec apres ${maxAttempts} tentative(s): ${lastFailure}`)
}
