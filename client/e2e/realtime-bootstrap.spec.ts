import { expect, test } from '@playwright/test'
import { waitForRealtimeReady } from './realtime'

type RealtimeBootstrapMetrics = {
  routeContentReadyAt: number | null
  realtimeImportStartedAt: number | null
  realtimeModuleLoadedAt: number | null
  realtimeConnectStartedAt: number | null
}

async function readBootstrapMetrics(page: import('@playwright/test').Page) {
  return page.evaluate<RealtimeBootstrapMetrics>(() => {
    const measuredWindow = window as typeof window & {
      __mayeleRouteContentReadyAt?: number
      __mayeleRealtimeImportStartedAt?: number
      __mayeleRealtimeModuleLoadedAt?: number
      __mayeleRealtimeConnectStartedAt?: number
    }

    return {
      routeContentReadyAt: measuredWindow.__mayeleRouteContentReadyAt ?? null,
      realtimeImportStartedAt: measuredWindow.__mayeleRealtimeImportStartedAt ?? null,
      realtimeModuleLoadedAt: measuredWindow.__mayeleRealtimeModuleLoadedAt ?? null,
      realtimeConnectStartedAt: measuredWindow.__mayeleRealtimeConnectStartedAt ?? null,
    }
  })
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('mayele.e2e.user', 'host'))
})

test('affiche le jeu solo avant de charger le transport temps reel global', async ({ page }) => {
  await page.goto('/jeu/solo', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('.challenge-config-board')).toBeVisible()
  await waitForRealtimeReady(page, 8_000)

  const metrics = await readBootstrapMetrics(page)
  console.log(`REALTIME_BOOTSTRAP solo ${JSON.stringify(metrics)}`)
  expect(metrics.routeContentReadyAt).not.toBeNull()
  expect(metrics.realtimeImportStartedAt).not.toBeNull()
  expect(metrics.realtimeModuleLoadedAt).not.toBeNull()
  expect(metrics.routeContentReadyAt!).toBeLessThanOrEqual(metrics.realtimeImportStartedAt!)
  expect(metrics.realtimeImportStartedAt!).toBeLessThanOrEqual(metrics.realtimeModuleLoadedAt!)
})

test('une route multijoueur prioritaire connecte sans attendre le bootstrap global', async ({ page }) => {
  await page.goto('/jeu/multijoueur', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('.multiplayer-lobby-grid')).toBeVisible()
  await waitForRealtimeReady(page, 8_000)

  const metrics = await readBootstrapMetrics(page)
  console.log(`REALTIME_BOOTSTRAP multiplayer ${JSON.stringify(metrics)}`)
  expect(metrics.routeContentReadyAt).not.toBeNull()
  expect(metrics.realtimeImportStartedAt).not.toBeNull()
  expect(metrics.realtimeConnectStartedAt).not.toBeNull()
  expect(Math.abs(metrics.realtimeImportStartedAt! - metrics.routeContentReadyAt!)).toBeLessThan(500)
  expect(metrics.realtimeConnectStartedAt! - metrics.realtimeImportStartedAt!).toBeLessThan(1_500)
})
