import { expect, type Page, type TestInfo, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const APP_URL = process.env.E2E_APP_URL ?? 'http://127.0.0.1:5175'
const CAPTURE_DIR = join(process.cwd(), '..', 'local_data', 'visual-captures')

async function authenticate(page: Page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('mayele.e2e.user', 'host')
    } catch {
      // Some transient browser documents do not expose localStorage.
    }
  })
}

async function expectNoHorizontalOverflow(page: Page, label: string) {
  const metrics = await page.evaluate(() => ({
    bodyScrollWidth: document.body.scrollWidth,
    docScrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }))
  const scrollWidth = Math.max(metrics.bodyScrollWidth, metrics.docScrollWidth)

  expect(scrollWidth, `${label}: scrollWidth=${scrollWidth}, innerWidth=${metrics.innerWidth}`).toBeLessThanOrEqual(metrics.innerWidth + 1)
}

async function attachScreenshot(page: Page, testInfo: TestInfo, name: string) {
  const body = await page.screenshot({ fullPage: true })
  mkdirSync(CAPTURE_DIR, { recursive: true })
  writeFileSync(join(CAPTURE_DIR, `${testInfo.project.name}-${name}.png`), body)
  await testInfo.attach(`${testInfo.project.name}-${name}`, { body, contentType: 'image/png' })
}

async function expectContained(page: Page, selector: string, label: string) {
  const offenders = await page.locator(selector).evaluateAll((nodes) => nodes.map((node, index) => {
    const rect = node.getBoundingClientRect()
    const scrollWidth = (node as HTMLElement).scrollWidth
    const clientWidth = (node as HTMLElement).clientWidth

    return {
      index,
      left: rect.left,
      right: rect.right,
      scrollWidth,
      clientWidth,
      viewportWidth: window.innerWidth,
    }
  }).filter((item) => item.left < -1 || item.right > item.viewportWidth + 1 || item.scrollWidth > item.clientWidth + 1))

  expect(offenders, `${label}: ${JSON.stringify(offenders.slice(0, 3))}`).toEqual([])
}

async function expectGridChildrenContained(page: Page, gridSelector: string, childSelector: string, label: string) {
  const offenders = await page.locator(gridSelector).evaluateAll((grids, childSelectorArg) => grids.flatMap((grid, gridIndex) => {
    const gridRect = grid.getBoundingClientRect()

    return Array.from(grid.querySelectorAll(childSelectorArg as string)).map((child, childIndex) => {
      const rect = child.getBoundingClientRect()

      return {
        gridIndex,
        childIndex,
        left: rect.left,
        right: rect.right,
        gridLeft: gridRect.left,
        gridRight: gridRect.right,
      }
    }).filter((item) => item.left < item.gridLeft - 1 || item.right > item.gridRight + 1)
  }), childSelector)

  expect(offenders, `${label}: ${JSON.stringify(offenders.slice(0, 3))}`).toEqual([])
}

test.beforeEach(async ({ page }) => {
  await authenticate(page)
})

test('dashboard desktop surfaces stay contained across browser engines', async ({ page }, testInfo) => {
  const views = [
    { path: '/dashboard', name: 'dashboard-overview', ready: '.dashboard-overview-section.active' },
    { path: '/dashboard?view=missions', name: 'dashboard-missions', ready: '.dashboard-plan-section.active' },
    { path: '/dashboard?view=stats', name: 'dashboard-stats', ready: '.dashboard-level-section.active' },
  ]

  for (const view of views) {
    await page.goto(`${APP_URL}${view.path}`)
    await expect(page.locator(view.ready)).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.desktop-sidebar')).toBeVisible()
    await attachScreenshot(page, testInfo, view.name)
    await expectNoHorizontalOverflow(page, view.name)
    await expectContained(page, '.dashboard-section-nav, .stats-insight-card, .operation-stat-card, .level-card, .mission-xp-card', view.name)

    if (view.name === 'dashboard-stats') {
      await expectGridChildrenContained(page, '.operation-stats-grid', '.operation-stat-card', view.name)
      await expectGridChildrenContained(page, '.dashboard-level-section .level-ladder', '.level-card', view.name)
    }
  }
})

test('solo setup desktop does not clip selectable controls', async ({ page }, testInfo) => {
  await page.goto(`${APP_URL}/jeu/solo`)
  await expect(page.getByRole('button', { name: /Commencer le sprint/i })).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.desktop-sidebar')).toBeVisible()
  await attachScreenshot(page, testInfo, 'solo-setup')
  await expectNoHorizontalOverflow(page, 'solo setup')
  await expectContained(page, '.challenge-config-board, .challenge-config-row, .challenge-operation-grid, .challenge-choice-tile', 'solo setup')
})
