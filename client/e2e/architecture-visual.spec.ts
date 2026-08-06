import { expect, type Page, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const APP_URL = process.env.E2E_APP_URL ?? 'http://127.0.0.1:5173'
const API_URL = process.env.E2E_API_URL ?? 'http://127.0.0.1:4000'
const CAPTURE_DIR = join(process.cwd(), '..', 'local_data', 'architecture-captures')

test.describe.configure({ timeout: 180_000 })

async function authenticate(page: Page) {
  await page.addInitScript(() => window.localStorage.setItem('mayele.e2e.user', 'host'))
}

function solvePrompt(prompt: string) {
  const values = prompt.match(/-?\d+/g)?.map(Number) ?? []

  if (values.length < 2) return 0
  if (prompt.includes('-')) return values[0] - values[1]
  if (prompt.includes('\u00d7') || prompt.toLowerCase().includes('x')) return values[0] * values[1]
  if (prompt.includes('\u00f7') || prompt.includes('/')) return Math.trunc(values[0] / values[1])
  return values[0] + values[1]
}

async function assertHealthySurface(page: Page, name: string) {
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(350)
  const metrics = await page.evaluate(() => ({
    width: window.innerWidth,
    body: document.body.scrollWidth,
    document: document.documentElement.scrollWidth,
  }))
  expect(Math.max(metrics.body, metrics.document), `${name} déborde horizontalement`).toBeLessThanOrEqual(metrics.width + 1)

  const body = await page.screenshot({ fullPage: true })
  mkdirSync(CAPTURE_DIR, { recursive: true })
  writeFileSync(join(CAPTURE_DIR, `${name}.png`), body)
}

test.beforeEach(async ({ page, request }) => {
  const reset = await request.post(`${API_URL}/api/e2e/reset-multiplayer`)
  expect(reset.ok()).toBe(true)
  await authenticate(page)
})

test('valide visuellement les nouvelles architectures hors landing page', async ({ page }) => {
  const runtimeErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(message.text())
  })
  page.on('pageerror', (error) => runtimeErrors.push(error.message))

  const surfaces = [
    { name: 'dashboard-overview', path: '/dashboard', ready: '.dashboard-overview-section.active' },
    { name: 'dashboard-stats', path: '/dashboard?view=stats', ready: '.performance-v2' },
    { name: 'dashboard-missions', path: '/dashboard?view=missions', ready: '.quest-path-board' },
    { name: 'dashboard-history', path: '/dashboard?view=history', ready: '.session-timeline' },
    { name: 'friends-roster', path: '/amis', ready: '.social-roster-layout' },
    { name: 'profile-settings', path: '/profil/configuration', ready: '.profile-settings-card' },
    { name: 'solo-setup', path: '/jeu/solo', ready: '.challenge-config-board' },
    { name: 'multiplayer-lobby', path: '/jeu/multijoueur', ready: '.multiplayer-lobby-grid' },
  ]

  for (const surface of surfaces) {
    await page.goto(`${APP_URL}${surface.path}`)
    await expect(page.locator(surface.ready)).toBeVisible({ timeout: 15_000 })
    await assertHealthySurface(page, surface.name)
  }

  await page.goto(`${APP_URL}/dashboard`)
  await page.getByRole('button', { name: 'Centre de notifications' }).click()
  await expect(page.locator('.notification-panel')).toBeVisible()
  await assertHealthySurface(page, 'notification-feed')

  await page.goto(`${APP_URL}/amis`)
  const friendProfileButton = page.getByRole('button', { name: 'Voir le profil' }).first()
  await expect(friendProfileButton).toBeVisible()
  await friendProfileButton.click()
  await expect(page.locator('.friend-versus-stage')).toBeVisible({ timeout: 15_000 })
  await assertHealthySurface(page, 'friend-versus-profile')

  await page.goto(`${APP_URL}/jeu/multijoueur`)
  await page.getByRole('button', { name: /nouveau d[eé]fi/i }).click()
  await expect(page.locator('.multiplayer-config-stage')).toBeVisible({ timeout: 15_000 })
  await page.locator('.multiplayer-config-mode').getByRole('button', { name: /Sprint/i }).click()
  await page.locator('.multiplayer-config-operation').getByRole('button', { name: /Addition/i }).click()
  await page.locator('.multiplayer-config-level').getByRole('button', { name: /D[eé]butant/i }).click()
  await expect(page.locator('.multiplayer-config-recap > .is-selected')).toHaveCount(3)
  await assertHealthySurface(page, 'multiplayer-room-config')

  await page.goto(`${APP_URL}/jeu/solo`)
  await page.getByRole('button', { name: /^Tempo$/ }).click()
  await page.getByRole('spinbutton', { name: 'Questions Tempo' }).fill('10')
  await page.getByRole('spinbutton', { name: 'Temps par question Tempo' }).fill('10')
  await page.getByRole('button', { name: /Commencer le tempo/i }).click()

  for (let questionIndex = 0; questionIndex < 10; questionIndex += 1) {
    const question = page.locator('.question-line')
    await expect(question).toBeVisible()
    const prompt = await question.innerText()
    await page.getByRole('textbox', { name: /Votre reponse/i }).fill(String(solvePrompt(prompt)))
    await page.getByRole('button', { name: /Valider/i }).click()

    if (questionIndex < 9) {
      await expect(question).not.toHaveText(prompt)
    }
  }

  await expect(page.locator('.solo-result-stage')).toBeVisible({ timeout: 15_000 })
  await assertHealthySurface(page, 'solo-result')

  expect(runtimeErrors, `Erreurs navigateur: ${runtimeErrors.join(' | ')}`).toEqual([])
})

test('valide les architectures principales sur mobile et tablette', async ({ page }) => {
  const runtimeErrors: string[] = []
  page.on('pageerror', (error) => runtimeErrors.push(error.message))

  for (const viewport of [
    { name: 'mobile', width: 390, height: 844 },
    { name: 'tablet', width: 768, height: 1024 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })

    for (const surface of [
      { name: 'overview', path: '/dashboard', ready: '.dashboard-overview-section.active' },
      { name: 'stats', path: '/dashboard?view=stats', ready: '.performance-v2' },
      { name: 'missions', path: '/dashboard?view=missions', ready: '.quest-path-board' },
      { name: 'history', path: '/dashboard?view=history', ready: '.session-timeline' },
      { name: 'friends', path: '/amis', ready: '.social-roster-layout' },
      { name: 'settings', path: '/profil/configuration', ready: '.profile-settings-card' },
      { name: 'solo', path: '/jeu/solo', ready: '.challenge-config-board' },
      { name: 'multiplayer', path: '/jeu/multijoueur', ready: '.multiplayer-lobby-grid' },
    ]) {
      await page.goto(`${APP_URL}${surface.path}`)
      await expect(page.locator(surface.ready)).toBeVisible({ timeout: 15_000 })
      await assertHealthySurface(page, `${viewport.name}-${surface.name}`)
    }

    await page.goto(`${APP_URL}/jeu/multijoueur`)
    await page.getByRole('button', { name: /nouveau d[eé]fi/i }).click()
    await expect(page.locator('.multiplayer-config-stage')).toBeVisible({ timeout: 15_000 })
    await page.locator('.multiplayer-config-mode').getByRole('button', { name: /Sprint/i }).click()
    await page.locator('.multiplayer-config-operation').getByRole('button', { name: /Addition/i }).click()
    await page.locator('.multiplayer-config-level').getByRole('button', { name: /D[eé]butant/i }).click()
    await expect(page.locator('.multiplayer-config-recap > .is-selected')).toHaveCount(3)
    await assertHealthySurface(page, `${viewport.name}-multiplayer-room`)
  }

  expect(runtimeErrors, `Erreurs navigateur responsive: ${runtimeErrors.join(' | ')}`).toEqual([])
})

test('valide les pages de connexion et inscription hors bypass E2E', async ({ page }) => {
  test.skip(process.env.E2E_AUTH_SURFACES !== '1', 'Ce contrôle utilise le client Clerk normal, sans identité E2E automatique.')

  const runtimeErrors: string[] = []
  page.on('pageerror', (error) => runtimeErrors.push(error.message))

  await page.goto(`${APP_URL}/connexion`)
  await expect(page.getByRole('heading', { name: 'Se connecter' })).toBeVisible({ timeout: 15_000 })
  await page.waitForTimeout(1_000)
  await expect(page).toHaveURL(/\/connexion/)
  await expect(page.getByRole('heading', { name: 'Se connecter' })).toBeVisible()
  await assertHealthySurface(page, 'login')

  await page.goto(`${APP_URL}/inscription`)
  await expect(page.getByRole('heading', { name: 'Créer votre compte' })).toBeVisible({ timeout: 15_000 })
  await page.waitForTimeout(1_000)
  await expect(page).toHaveURL(/\/inscription/)
  await expect(page.getByRole('heading', { name: 'Créer votre compte' })).toBeVisible()
  await expect(page.getByText('Vos informations')).toBeVisible()
  await assertHealthySurface(page, 'register')

  expect(runtimeErrors, `Erreurs navigateur auth: ${runtimeErrors.join(' | ')}`).toEqual([])
})
