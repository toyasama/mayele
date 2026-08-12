import { expect, type Page, test } from '@playwright/test'

const APP_URL = process.env.E2E_APP_URL ?? 'http://127.0.0.1:5173'
const API_URL = process.env.E2E_API_URL ?? 'http://127.0.0.1:4000'

async function authenticate(page: Page) {
  await page.addInitScript(() => window.localStorage.setItem('mayele.e2e.user', 'host'))
}

test.beforeEach(async ({ page, request }) => {
  const reset = await request.post(`${API_URL}/api/e2e/reset-multiplayer`)
  expect(reset.ok()).toBe(true)
  await authenticate(page)
  await page.setViewportSize({ width: 390, height: 844 })
})

test('les badges recents restent bornes apres le chargement des styles sociaux', async ({ page }) => {
  await page.goto(`${APP_URL}/amis`)
  await expect(page.locator('.social-roster-layout')).toBeVisible()

  await page.getByRole('link', { name: 'Mon espace' }).click()
  const card = page.locator('.dashboard-profile-badge-card').first()
  await expect(card).toBeVisible()
  await expect(card).not.toHaveClass(/friend-badge-card/)

  const layout = await card.evaluate((element) => {
    const viewport = element.querySelector<HTMLElement>('.dashboard-badge-art-viewport')
    if (!viewport) return null
    const cardBox = element.getBoundingClientRect()
    const viewportBox = viewport.getBoundingClientRect()
    return {
      contained:
        viewportBox.left >= cardBox.left
        && viewportBox.right <= cardBox.right
        && viewportBox.top >= cardBox.top
        && viewportBox.bottom <= cardBox.bottom,
      overflow: getComputedStyle(viewport).overflow,
    }
  })

  expect(layout).toEqual({ contained: true, overflow: 'hidden' })
})

test('un badge de rang trois ne deborde pas dans sa fiche mobile', async ({ page }) => {
  await page.goto(`${APP_URL}/dashboard?view=missions`)
  await expect(page.locator('.trophy-cabinet')).toBeVisible()
  const seriesTab = page.locator('#trophy-family-streak')
  await seriesTab.evaluate((element: HTMLElement) => element.click())
  await expect(seriesTab).toHaveAttribute('aria-selected', 'true')
  const badge = page.locator('.trophy-item.badge-streak_long').nth(1)
  await expect(badge).toBeAttached()
  await badge.evaluate((element: HTMLElement) => element.click())

  const dialog = page.locator('.dashboard-badge-sheet')
  await expect(dialog).toBeVisible()
  const layout = await dialog.evaluate((element) => {
    const header = element.querySelector<HTMLElement>('.dashboard-badge-sheet-header')
    const viewport = element.querySelector<HTMLElement>('.dashboard-badge-art-viewport')
    if (!header || !viewport) return null
    const headerBox = header.getBoundingClientRect()
    const viewportBox = viewport.getBoundingClientRect()
    const sheetBox = element.getBoundingClientRect()
    return {
      viewportContained:
        viewportBox.left >= headerBox.left
        && viewportBox.right <= headerBox.right
        && viewportBox.top >= headerBox.top
        && viewportBox.bottom <= headerBox.bottom,
      sheetContained: sheetBox.left >= 0 && sheetBox.right <= window.innerWidth,
      overflow: getComputedStyle(viewport).overflow,
    }
  })

  expect(layout).toEqual({
    viewportContained: true,
    sheetContained: true,
    overflow: 'hidden',
  })
})
