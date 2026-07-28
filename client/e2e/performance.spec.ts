import { expect, type Browser, test } from '@playwright/test'

const APP_URL = process.env.E2E_APP_URL ?? 'http://127.0.0.1:5373'
const API_URL = process.env.E2E_API_URL ?? 'http://127.0.0.1:4300'

type ApiMeasurement = { path: string; status: number; durationMs: number }

async function measureRoute(browser: Browser, path: string, readySelector: string) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.addInitScript(() => window.localStorage.setItem('mayele.e2e.user', 'host'))
  const startedRequests = new Map<string, number[]>()
  const api: ApiMeasurement[] = []

  page.on('request', (request) => {
    const url = new URL(request.url())
    if (!url.pathname.startsWith('/api/')) return
    const starts = startedRequests.get(request.url()) ?? []
    starts.push(Date.now())
    startedRequests.set(request.url(), starts)
  })
  page.on('response', (response) => {
    const url = new URL(response.url())
    if (!url.pathname.startsWith('/api/')) return
    const starts = startedRequests.get(response.url()) ?? []
    const startedAt = starts.shift() ?? Date.now()
    api.push({ path: url.pathname, status: response.status(), durationMs: Date.now() - startedAt })
  })

  const startedAt = Date.now()
  await page.goto(`${APP_URL}${path}`, { waitUntil: 'domcontentloaded' })
  await page.locator(readySelector).waitFor({ state: 'visible', timeout: 20_000 })
  const readyMs = Date.now() - startedAt
  await page.waitForTimeout(500)
  const resources = await page.evaluate(() => performance.getEntriesByType('resource').map((entry) => {
    const resource = entry as PerformanceResourceTiming
    return {
      name: new URL(resource.name).pathname,
      durationMs: Math.round(resource.duration),
      transferSize: resource.transferSize,
    }
  }))
  await context.close()

  return { path, readyMs, api, resources }
}

function countApi(result: Awaited<ReturnType<typeof measureRoute>>, path: string) {
  return result.api.filter((request) => request.path === path).length
}

test('mesure les routes authentifiées et interdit les préchargements hors contexte', async ({ browser, request }, testInfo) => {
  const reset = await request.post(`${API_URL}/api/e2e/reset-multiplayer`)
  expect(reset.ok()).toBe(true)
  const players = (await reset.json()) as { players: { guest: { id: string } } }

  const solo = await measureRoute(browser, '/jeu/solo', '.challenge-config-board')
  const dashboard = await measureRoute(browser, '/dashboard', '.dashboard-overview-section.active')
  const multiplayer = await measureRoute(browser, '/jeu/multijoueur', '.multiplayer-lobby-grid')
  const friend = await measureRoute(browser, `/amis/${players.players.guest.id}`, '.friend-versus-stage')
  const results = { solo, dashboard, multiplayer, friend }

  await testInfo.attach('route-performance-results', {
    body: JSON.stringify(results, null, 2),
    contentType: 'application/json',
  })

  expect(countApi(solo, '/api/dashboard')).toBe(0)
  expect(countApi(solo, '/api/friends/overview')).toBe(0)
  expect(countApi(dashboard, '/api/dashboard')).toBe(1)
  expect(countApi(dashboard, '/api/friends/overview')).toBe(0)
  expect(countApi(friend, '/api/dashboard')).toBe(0)
  expect(countApi(friend, `/api/friends/${players.players.guest.id}/profile`)).toBe(1)
  expect(countApi(multiplayer, '/api/matches/room-overview')).toBe(1)
})
