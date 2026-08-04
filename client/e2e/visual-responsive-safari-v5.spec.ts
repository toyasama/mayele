import { expect, type Locator, type Page, test } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const APP_URL = process.env.E2E_APP_URL ?? 'http://127.0.0.1:5773'
const API_URL = process.env.E2E_API_URL ?? 'http://127.0.0.1:4700'
const CAPTURE_DIR = join(process.cwd(), '..', 'local_data', 'architecture-captures-v5')

type Surface = {
  name: string
  path: string
  ready: string
}

function solvePrompt(prompt: string) {
  const values = prompt.match(/-?\d+/g)?.map(Number) ?? []

  if (values.length < 2) return 0
  if (prompt.includes('-')) return values[0] - values[1]
  if (prompt.includes('×') || prompt.toLowerCase().includes('x')) return values[0] * values[1]
  if (prompt.includes('÷') || prompt.includes('/')) return Math.trunc(values[0] / values[1])
  return values[0] + values[1]
}

const coreSurfaces: Surface[] = [
  { name: 'dashboard-overview', path: '/dashboard', ready: '.dashboard-overview-section.active' },
  { name: 'dashboard-stats', path: '/dashboard?view=stats', ready: '.performance-v2' },
  { name: 'dashboard-missions', path: '/dashboard?view=missions', ready: '.quest-path-board' },
  { name: 'dashboard-history', path: '/dashboard?view=history', ready: '.session-timeline' },
  { name: 'friends-roster', path: '/amis', ready: '.social-roster-layout' },
  { name: 'profile-settings', path: '/profil/configuration', ready: '.profile-settings-card' },
  { name: 'solo-setup', path: '/jeu/solo', ready: '.challenge-config-board' },
  { name: 'multiplayer-lobby', path: '/jeu/multijoueur', ready: '.multiplayer-lobby-grid' },
]

function installRuntimeCollection(page: Page, runtimeErrors: string[], failedRequests: string[]) {
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(message.text())
  })
  page.on('pageerror', (error) => runtimeErrors.push(error.message))
  page.on('requestfailed', (request) => {
    if (request.url().startsWith('https://va.vercel-scripts.com/')) return
    const failure = request.failure()?.errorText ?? 'unknown failure'
    failedRequests.push(`${request.method()} ${request.url()} (${failure})`)
  })
}

async function authenticate(page: Page) {
  await page.addInitScript(() => window.localStorage.setItem('mayele.e2e.user', 'host'))
}

async function assertNoHorizontalOverflow(page: Page, surface: string) {
  const metrics = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    body: document.body.scrollWidth,
    document: document.documentElement.scrollWidth,
  }))

  expect(
    Math.max(metrics.body, metrics.document),
    `${surface}: largeur document ${Math.max(metrics.body, metrics.document)}px pour viewport ${metrics.viewport}px`,
  ).toBeLessThanOrEqual(metrics.viewport + 1)
}

async function assertVisibleElementsStayInViewport(page: Page, surface: string) {
  const offenders = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth
    const candidates = Array.from(document.querySelectorAll<HTMLElement>('button, input, select, textarea, [role="button"], h1, h2'))

    return candidates.flatMap((element) => {
      const style = getComputedStyle(element)
      if (style.display === 'none' || style.visibility === 'hidden') return []
      const rect = element.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return []
      if (rect.right <= viewportWidth + 1 && rect.left >= -1) return []

      let ancestor = element.parentElement
      while (ancestor) {
        const ancestorStyle = getComputedStyle(ancestor)
        if (/(auto|scroll)/.test(ancestorStyle.overflowX) && ancestor.scrollWidth > ancestor.clientWidth) return []
        ancestor = ancestor.parentElement
      }

      return [{
        tag: element.tagName,
        text: (element.getAttribute('aria-label') || element.textContent || '').trim().slice(0, 80),
        left: Math.round(rect.left),
        right: Math.round(rect.right),
      }]
    })
  })

  const layoutEvidence = offenders.length ? await page.evaluate(() => {
    const selectors = ['html', 'body', '#root', '.app-shell', '.main-content', '.friends-page', '.friends-panel', '.social-roster-layout', '.social-profile-detail']
    return {
      innerWidth: window.innerWidth,
      visualWidth: window.visualViewport?.width ?? null,
      elements: selectors.map((selector) => {
        const element = document.querySelector<HTMLElement>(selector)
        if (!element) return { selector, missing: true }
        const rect = element.getBoundingClientRect()
        const style = getComputedStyle(element)
        return {
          selector,
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          minWidth: style.minWidth,
          maxWidth: style.maxWidth,
          overflowX: style.overflowX,
        }
      }),
    }
  }) : null

  expect(offenders, `${surface}: contrôles ou titres coupés ${JSON.stringify(offenders)}; layout ${JSON.stringify(layoutEvidence)}`).toEqual([])
}

async function captureSurface(page: Page, projectName: string, name: string) {
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(300)
  mkdirSync(CAPTURE_DIR, { recursive: true })
  await page.screenshot({
    animations: 'disabled',
    fullPage: true,
    path: join(CAPTURE_DIR, `${projectName}--${name}.png`),
  })
  await assertNoHorizontalOverflow(page, name)
  await assertVisibleElementsStayInViewport(page, name)
}

async function gotoSurface(page: Page, surface: Surface) {
  await page.goto(`${APP_URL}${surface.path}`, { waitUntil: 'domcontentloaded' })
  await expect(page.locator(surface.ready), `${surface.name}: contenu principal absent`).toBeVisible()
  await expect(page.locator('.vite-error-overlay, [data-nextjs-dialog]')).toHaveCount(0)
}

async function clickFirstVisible(locator: Locator) {
  const count = await locator.count()
  for (let index = 0; index < count; index += 1) {
    if (await locator.nth(index).isVisible()) {
      await locator.nth(index).click()
      return
    }
  }
  throw new Error('Aucun élément visible ne correspond au locator demandé.')
}

test.beforeEach(async ({ page, request }) => {
  const reset = await request.post(`${API_URL}/api/e2e/reset-multiplayer`)
  expect(reset.ok(), 'La fixture multijoueur doit etre remise a zero avant le controle visuel.').toBeTruthy()
  await authenticate(page)
})

test('Safari iPhone conserve le focus apres une validation tactile', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'webkit-iphone-safari', 'Regression specifique au clavier Safari iPhone.')

  await gotoSurface(page, coreSurfaces[6])
  await page.getByRole('button', { name: /Commencer le sprint/i }).click()
  await expect(page.locator('.question-line')).toBeVisible()

  const input = page.getByRole('textbox', { name: /Votre reponse/i })
  const prompt = await page.locator('.question-line').innerText()
  await input.fill(String(solvePrompt(prompt)))
  await page.getByRole('button', { name: /Valider/i }).click()

  await expect(page.locator('.challenge-run-answer-summary')).toContainText('1')
  await expect(input).not.toHaveAttribute('readonly')
  await expect(input).toBeFocused()
})

test('toutes les vues principales restent lisibles et sans débordement', async ({ page }, testInfo) => {
  const runtimeErrors: string[] = []
  const failedRequests: string[] = []
  installRuntimeCollection(page, runtimeErrors, failedRequests)

  for (const surface of coreSurfaces) {
    await gotoSurface(page, surface)
    await captureSurface(page, testInfo.project.name, surface.name)
  }

  expect(runtimeErrors, `Erreurs console/page: ${runtimeErrors.join(' | ')}`).toEqual([])
  expect(failedRequests, `Requêtes échouées: ${failedRequests.join(' | ')}`).toEqual([])
})

test('navigation mobile/tablette, notifications et vues secondaires restent utilisables', async ({ page }, testInfo) => {
  const runtimeErrors: string[] = []
  const failedRequests: string[] = []
  installRuntimeCollection(page, runtimeErrors, failedRequests)

  await gotoSurface(page, coreSurfaces[0])
  const isCompact = (page.viewportSize()?.width ?? 1440) < 1024

  if (isCompact) {
    const bottomNavigation = page.locator('.mobile-bottom-nav')
    await expect(bottomNavigation).toBeVisible()
    await expect(page.locator('.desktop-sidebar')).toBeHidden()
    await clickFirstVisible(page.getByRole('button', { name: /menu/i }))
    await expect(page.locator('.mobile-menu-panel')).toBeVisible()
    await captureSurface(page, testInfo.project.name, 'mobile-drawer')
    await page.keyboard.press('Escape')
    await expect(page.locator('.mobile-menu-panel')).toBeHidden()
  } else {
    await expect(page.locator('.desktop-sidebar')).toBeVisible()
    await expect(page.locator('.mobile-bottom-nav')).toBeHidden()
  }

  await page.getByRole('button', { name: 'Centre de notifications' }).click()
  await expect(page.locator('.notification-panel')).toBeVisible()
  await captureSurface(page, testInfo.project.name, 'notification-center')
  await page.getByRole('button', { name: 'Centre de notifications' }).click()

  await gotoSurface(page, coreSurfaces[4])
  if (isCompact) {
    await page.locator('.social-roster-item').first().click()
    await expect(page.locator('.social-profile-detail.mobile-open')).toBeVisible()
  }
  const profileButton = page.getByRole('button', { name: 'Voir le profil' }).first()
  await expect(profileButton).toBeVisible()
  await profileButton.click()
  await expect(page.locator('.friend-versus-stage')).toBeVisible()
  await captureSurface(page, testInfo.project.name, 'friend-profile')

  await gotoSurface(page, coreSurfaces[7])
  await page.getByRole('button', { name: /nouveau défi/i }).click()
  await expect(page.locator('.multiplayer-config-stage')).toBeVisible()
  await captureSurface(page, testInfo.project.name, 'multiplayer-config-empty')
  await page.locator('.multiplayer-config-mode').getByRole('button', { name: 'Sprint' }).click()
  await page.locator('.multiplayer-config-operation').getByRole('button', { name: 'Addition' }).click()
  await page.locator('.multiplayer-config-level').getByRole('button', { name: 'Débutant' }).click()
  await expect(page.locator('.multiplayer-config-recap > .is-selected')).toHaveCount(3)
  await captureSurface(page, testInfo.project.name, 'multiplayer-config-ready')

  expect(runtimeErrors, `Erreurs console/page: ${runtimeErrors.join(' | ')}`).toEqual([])
  expect(failedRequests, `Requêtes échouées: ${failedRequests.join(' | ')}`).toEqual([])
})

test('le parcours solo authoritative résiste au rechargement et affiche le résultat', async ({ page }, testInfo) => {
  const runtimeErrors: string[] = []
  const failedRequests: string[] = []
  installRuntimeCollection(page, runtimeErrors, failedRequests)

  await gotoSurface(page, coreSurfaces[6])
  await page.getByRole('button', { name: 'Tempo', exact: true }).click()
  await page.getByRole('button', { name: /Informations sur les modes de jeu/i }).click()
  await page.getByRole('spinbutton', { name: 'Questions Tempo' }).fill('10')
  await page.getByRole('spinbutton', { name: 'Temps par question Tempo' }).fill('10')
  await page.getByRole('button', { name: /C’est compris/i }).click()
  await page.getByRole('button', { name: /Commencer le tempo/i }).click()
  await expect(page.locator('.question-line')).toBeVisible()
  await captureSurface(page, testInfo.project.name, 'solo-run')

  for (let questionIndex = 0; questionIndex < 10; questionIndex += 1) {
    const question = page.locator('.question-line')
    await expect(question).toBeVisible()
    const prompt = await question.innerText()
    await page.getByRole('textbox', { name: /Votre reponse/i }).fill(String(solvePrompt(prompt)))
    await page.getByRole('button', { name: /Valider/i }).click()

    if (questionIndex === 0) {
      await expect(page.locator('.challenge-run-context small')).toHaveText('Question 2/10')
      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(page.locator('.question-line')).toBeVisible()
      await expect(page.locator('.challenge-run-context small')).toHaveText('Question 2/10')
      await captureSurface(page, testInfo.project.name, 'solo-run-restored')
    } else if (questionIndex < 9) {
      await expect(question).not.toHaveText(prompt)
    }
  }

  await expect(page.locator('.solo-result-stage')).toBeVisible()
  await expect(page.locator('.solo-result-metrics')).toContainText('10/10')
  await captureSurface(page, testInfo.project.name, 'solo-result')

  expect(runtimeErrors, `Erreurs console/page: ${runtimeErrors.join(' | ')}`).toEqual([])
  expect(failedRequests, `Requêtes échouées: ${failedRequests.join(' | ')}`).toEqual([])
})
