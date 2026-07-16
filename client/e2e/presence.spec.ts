import { expect, type APIRequestContext, type Browser, type Page, test } from '@playwright/test'
import { waitForRealtimeReady } from './realtime'

const APP_URL = process.env.E2E_APP_URL ?? 'http://127.0.0.1:5173'
const API_URL = process.env.E2E_API_URL ?? 'http://127.0.0.1:4000'

async function resetMultiplayerFixture(request: APIRequestContext) {
  const reset = await request.post(`${API_URL}/api/e2e/reset-multiplayer`)
  expect(reset.ok()).toBeTruthy()
}

async function authenticatedPage(browser: Browser, user: 'host' | 'guest') {
  const context = await browser.newContext()
  await context.addInitScript((value) => {
    window.localStorage.setItem('mayele.e2e.user', value)
  }, user)
  const page = await context.newPage()

  return { context, page }
}

function friendCard(page: Page, name: string) {
  return page.locator('.profile-card').filter({ hasText: name }).first()
}

test('la presence ami suit activement le cycle de vie de son onglet', async ({ browser, request }) => {
  await resetMultiplayerFixture(request)
  const host = await authenticatedPage(browser, 'host')
  const guest = await authenticatedPage(browser, 'guest')

  try {
    await guest.page.goto(`${APP_URL}/amis`)
    await waitForRealtimeReady(guest.page)
    await host.page.goto(`${APP_URL}/amis`)
    await waitForRealtimeReady(host.page)

    const guestCard = friendCard(host.page, 'Bob Guest')
    await expect(guestCard).toContainText('En ligne')

    await guest.page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await expect(guestCard).toContainText('Absent')

    await guest.context.close()
    await expect(guestCard).toContainText('Hors ligne')
  } finally {
    await host.context.close()
  }
})

test('le joueur peut apparaitre hors ligne sans quitter puis redevient visible a sa prochaine connexion', async ({ browser, request }) => {
  await resetMultiplayerFixture(request)
  let host = await authenticatedPage(browser, 'host')
  const guest = await authenticatedPage(browser, 'guest')

  try {
    await guest.page.goto(`${APP_URL}/amis`)
    await waitForRealtimeReady(guest.page)
    await host.page.goto(`${APP_URL}/amis`)
    await waitForRealtimeReady(host.page)

    const guestCard = friendCard(host.page, 'Bob Guest')
    const hostCard = friendCard(guest.page, 'Alice Host')
    await expect(hostCard).toContainText('En ligne')

    await host.page.getByRole('button', { name: 'Apparaitre hors ligne' }).click()
    await expect(host.page.getByRole('button', { name: 'Apparaitre en ligne' })).toBeVisible()
    await expect(hostCard).toContainText('Hors ligne')
    await expect(guestCard).toContainText('En ligne')

    await host.context.close()
    host = await authenticatedPage(browser, 'host')
    await host.page.goto(`${APP_URL}/amis`)
    await waitForRealtimeReady(host.page)

    await expect(host.page.getByRole('button', { name: 'Apparaitre hors ligne' })).toBeVisible()
    await expect(hostCard).toContainText('En ligne')
  } finally {
    await host.context.close()
    await guest.context.close()
  }
})
