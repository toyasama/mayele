import { expect, type APIRequestContext, type Browser, type Page, test } from '@playwright/test'

const APP_URL = process.env.E2E_APP_URL ?? 'http://127.0.0.1:5173'
const API_URL = process.env.E2E_API_URL ?? 'http://127.0.0.1:4000'
const ANSWER_UI_CI_BUDGET_MS = Number(process.env.E2E_ANSWER_UI_BUDGET_MS ?? 50)

if (!Number.isFinite(ANSWER_UI_CI_BUDGET_MS) || ANSWER_UI_CI_BUDGET_MS <= 0) {
  throw new Error('E2E_ANSWER_UI_BUDGET_MS doit etre un nombre strictement positif.')
}

async function resetMultiplayerFixture(request: APIRequestContext) {
  const reset = await request.post(`${API_URL}/api/e2e/reset-multiplayer`)
  expect(reset.ok()).toBeTruthy()
}

async function e2ePage(browser: Browser) {
  const context = await browser.newContext()
  await context.addInitScript(() => {
    try {
      window.localStorage.setItem('mayele.e2e.user', 'host')
    } catch {
      // Some transient browser documents do not expose localStorage.
    }
  })
  const page = await context.newPage()

  return {
    context,
    page,
  }
}

function solvePrompt(prompt: string) {
  const values = prompt.match(/-?\d+/g)?.map(Number) ?? []

  if (values.length < 2) {
    return 0
  }

  if (prompt.includes('-')) {
    return values[0] - values[1]
  }

  if (prompt.includes('\u00d7') || prompt.toLowerCase().includes('x')) {
    return values[0] * values[1]
  }

  if (prompt.includes('\u00f7') || prompt.includes('/')) {
    return Math.trunc(values[0] / values[1])
  }

  return values[0] + values[1]
}

async function readChallengeTimer(page: Page) {
  return Number(await page.locator('.challenge-clock strong').innerText())
}

async function readChallengeProgressLabel(page: Page) {
  return page.locator('.challenge-progress strong').innerText()
}

async function submitAndObserveAnswerCountLatencyMs(page: Page) {
  return page.evaluate(() => new Promise<number>((resolve, reject) => {
    const answerCount = () => document.querySelector('.challenge-run-answer-summary b')?.textContent?.trim() ?? ''
    const button = Array.from(document.querySelectorAll('button')).find((item) => /Valider/i.test(item.textContent ?? '') && !item.disabled)

    if (!button) {
      reject(new Error('Enabled submit button not found'))
      return
    }

    const startedAt = performance.now()
    const observer = new MutationObserver(() => {
      if (answerCount() !== '1') return
      window.clearTimeout(timeoutId)
      observer.disconnect()
      resolve(performance.now() - startedAt)
    })
    const timeoutId = window.setTimeout(() => {
      observer.disconnect()
      reject(new Error('Optimistic answer count was not rendered'))
    }, 1_000)

    observer.observe(document.body, { characterData: true, childList: true, subtree: true })
    button.click()
  }))
}

async function selectSoloMode(page: Page, mode: 'Sprint' | 'Tempo') {
  await page.getByRole('button', { name: new RegExp(`^${mode}$`, 'i') }).click()
}

async function startSoloSprint(page: Page, durationSeconds = 60) {
  await page.goto(`${APP_URL}/jeu/solo`)
  await page.getByRole('button', { name: /Informations sur les modes de jeu/i }).click()
  await page.getByLabel(/Duree Sprint/i).selectOption(String(durationSeconds))
  await page.getByRole('button', { name: /C’est compris/i }).click()
  await page.getByRole('button', { name: /Commencer le sprint|Rejouer le sprint/i }).click()
  await expect(page.locator('.question-line')).toBeVisible()
  await expect(page.getByRole('textbox', { name: /Votre reponse/i })).toBeFocused()
}

async function startSoloTempo(page: Page, perQuestionSeconds = 10) {
  await page.goto(`${APP_URL}/jeu/solo`)
  await selectSoloMode(page, 'Tempo')
  await page.getByRole('button', { name: /Informations sur les modes de jeu/i }).click()
  await page.getByLabel(/Temps par question Tempo/i).fill(String(perQuestionSeconds))
  await page.getByRole('button', { name: /C’est compris/i }).click()
  await page.getByRole('button', { name: /Commencer le tempo|Rejouer le tempo/i }).click()
  await expect(page.locator('.question-line')).toBeVisible()
  await expect(page.getByText(/Question 1\/30/i)).toBeVisible()
  await expect(page.getByRole('textbox', { name: /Votre reponse/i })).toBeFocused()
}

test.beforeEach(async ({ request }) => {
  await resetMultiplayerFixture(request)
})

test('capture le mode solo lance avec la mise en page epuree', async ({ browser }) => {
  const { context, page } = await e2ePage(browser)

  try {
    await startSoloSprint(page)
    await page.screenshot({ path: 'test-results/solo-play-refined.png', fullPage: true })
  } finally {
    await context.close()
  }
})

test('solo sprint valide une reponse en quelques millisecondes et conserve le focus', async ({ browser }, testInfo) => {
  const { context, page } = await e2ePage(browser)

  try {
    await startSoloSprint(page)
    const prompt = await page.locator('.question-line').innerText()
    await page.getByRole('textbox', { name: /Votre reponse/i }).fill(String(solvePrompt(prompt)))
    const latencyMs = await submitAndObserveAnswerCountLatencyMs(page)

    console.info(`[performance] solo-answer-ui=${latencyMs.toFixed(2)}ms`)
    await testInfo.attach('solo-answer-ui.json', {
      body: JSON.stringify({ latencyMs, thresholdMs: ANSWER_UI_CI_BUDGET_MS }, null, 2),
      contentType: 'application/json',
    })
    expect(latencyMs).toBeLessThan(ANSWER_UI_CI_BUDGET_MS)

    await expect(page.locator('.challenge-metrics > div').nth(0).locator('strong')).not.toHaveText('0')
    await expect(page.locator('.challenge-metrics > div').nth(1).locator('strong')).toHaveText('1')
    await expect(page.getByRole('textbox', { name: /Votre reponse/i })).toBeFocused()
  } finally {
    await context.close()
  }
})

test('solo sprint valide une reponse avec la touche entree du clavier mobile', async ({ browser }) => {
  const { context, page } = await e2ePage(browser)

  try {
    await startSoloSprint(page)
    const prompt = await page.locator('.question-line').innerText()
    const input = page.getByRole('textbox', { name: /Votre reponse/i })

    await expect(input).toHaveAttribute('enterkeyhint', 'enter')
    await expect(input).toHaveAttribute('aria-keyshortcuts', 'Enter')
    await input.fill(String(solvePrompt(prompt)))
    await input.press('Enter')

    await expect(page.locator('.challenge-metrics > div').nth(0).locator('strong')).not.toHaveText('0')
    await expect(page.locator('.challenge-metrics > div').nth(1).locator('strong')).toHaveText('1')
    await expect(input).toBeFocused()
  } finally {
    await context.close()
  }
})

test('solo sprint demande confirmation avant de changer de mode en pleine partie', async ({ browser }) => {
  const { context, page } = await e2ePage(browser)

  try {
    await startSoloSprint(page)
    await page.getByRole('button', { name: /^Multijoueur$/i }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page).toHaveURL(/\/jeu\/solo/)

    await page.getByRole('button', { name: /Rester/i }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(page.locator('.question-line')).toBeVisible()

    await page.getByRole('button', { name: /^Multijoueur$/i }).click()
    await page.getByRole('button', { name: /Confirmer/i }).click()
    await expect(page).toHaveURL(/\/jeu\/multijoueur/)
  } finally {
    await context.close()
  }
})

for (const sprintDuration of [60, 90, 120] as const) {
  test(`solo sprint ${sprintDuration} secondes demarre avec timer et progression bornes`, async ({ browser }) => {
    const { context, page } = await e2ePage(browser)

    try {
      await startSoloSprint(page, sprintDuration)

      await expect.poll(() => readChallengeTimer(page)).toBeLessThanOrEqual(sprintDuration)
      await expect.poll(() => readChallengeProgressLabel(page)).toMatch(new RegExp(`/${sprintDuration}$`))
      await expect(page.locator('.challenge-arena')).not.toHaveClass(/is-critical/)
      await page.screenshot({ path: `test-results/solo-sprint-${sprintDuration}.png`, fullPage: true })
    } finally {
      await context.close()
    }
  })
}

for (const tempoSeconds of [5, 10, 30] as const) {
  test(`solo tempo ${tempoSeconds} secondes par question demarre avec timer borne`, async ({ browser }) => {
    const { context, page } = await e2ePage(browser)

    try {
      await startSoloTempo(page, tempoSeconds)

      await expect.poll(() => readChallengeTimer(page)).toBeLessThanOrEqual(tempoSeconds)
      await expect.poll(() => readChallengeProgressLabel(page)).toMatch(new RegExp(`/${tempoSeconds}$`))
      await expect(page.getByText(/Question 1\/30/i)).toBeVisible()
      await page.screenshot({ path: `test-results/solo-tempo-${tempoSeconds}.png`, fullPage: true })
    } finally {
      await context.close()
    }
  })
}

test('solo tempo met a jour le score puis avance a la question suivante', async ({ browser }) => {
  const { context, page } = await e2ePage(browser)

  try {
    await startSoloTempo(page, 5)
    const prompt = await page.locator('.question-line').innerText()
    await page.getByRole('textbox', { name: /Votre reponse/i }).fill(String(solvePrompt(prompt)))
    await page.getByRole('button', { name: /Valider/i }).click()

    await expect(page.getByText(/Question 2\/30/i)).toBeVisible()
    await expect(page.locator('.challenge-metrics > div').nth(0).locator('strong')).not.toHaveText('0')
    await expect(page.locator('.challenge-metrics > div').nth(1).locator('strong')).toHaveText('1')
    await expect(page.getByRole('textbox', { name: /Votre reponse/i })).toBeFocused()
    await page.screenshot({ path: 'test-results/solo-tempo-after-answer.png', fullPage: true })
  } finally {
    await context.close()
  }
})

test('solo tempo timeout vide enregistre une reponse absente et avance', async ({ browser }) => {
  const { context, page } = await e2ePage(browser)

  try {
    await startSoloTempo(page, 5)

    await expect(page.getByText(/Question 2\/30/i)).toBeVisible({ timeout: 7_000 })
    await expect(page.getByText(/Aucune/i)).toBeVisible()
    await expect(page.locator('.challenge-metrics > div').nth(2).locator('strong')).toHaveText('0%')
    await page.screenshot({ path: 'test-results/solo-tempo-empty-timeout.png', fullPage: true })
  } finally {
    await context.close()
  }
})
