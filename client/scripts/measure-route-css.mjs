import { chromium } from '@playwright/test'

const baseUrl = process.env.E2E_APP_URL ?? 'http://127.0.0.1:5173'
const routes = [
  { name: 'solo', path: '/jeu/solo', expectedChunk: 'GamePage-' },
  { name: 'dashboard', path: '/dashboard', expectedChunk: 'DashboardPage-' },
  { name: 'friends', path: '/amis', expectedChunk: 'FriendsPage-' },
  { name: 'multiplayer', path: '/jeu/multijoueur', expectedChunk: 'MultiplayerGamePage-' },
]

const results = []

for (const route of routes) {
  const browser = await chromium.launch()
  const context = await browser.newContext()
  const page = await context.newPage()

  await page.addInitScript(() => window.localStorage.setItem('mayele.e2e.user', 'host'))
  await page.goto(`${baseUrl}${route.path}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1_000)

  const stylesheets = await page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .filter((entry) => entry.name.includes('/assets/') && entry.name.endsWith('.css'))
      .map((entry) => {
        const resource = entry
        return {
          file: new URL(resource.name).pathname.split('/').at(-1),
          decodedBytes: 'decodedBodySize' in resource ? resource.decodedBodySize : 0,
          transferBytes: 'transferSize' in resource ? resource.transferSize : 0,
        }
      }),
  )
  const cascadeOrder = await page.evaluate(() =>
    Array.from(document.styleSheets)
      .map((stylesheet) => stylesheet.href)
      .filter((href) => href?.includes('/assets/'))
      .map((href) => new URL(href).pathname.split('/').at(-1)),
  )

  const files = stylesheets.map((stylesheet) => stylesheet.file)
  const hasInitialCss = files.some((file) => file?.startsWith('index-'))
  const hasExpectedRouteCss = files.some((file) => file?.startsWith(route.expectedChunk))

  if (!hasInitialCss || !hasExpectedRouteCss) {
    throw new Error(`${route.name}: fragments CSS inattendus (${files.join(', ')})`)
  }

  results.push({
    route: route.path,
    decodedBytes: stylesheets.reduce((total, stylesheet) => total + stylesheet.decodedBytes, 0),
    transferBytes: stylesheets.reduce((total, stylesheet) => total + stylesheet.transferBytes, 0),
    cascadeOrder,
    stylesheets,
  })

  await browser.close()
}

console.log(JSON.stringify(results, null, 2))
