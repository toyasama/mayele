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

async function submitAndObserveNextQuestionLatencyMs(page: Page) {
  return page.evaluate(() => new Promise<number>((resolve, reject) => {
    const question = document.querySelector<HTMLElement>('.question-line')
    const initialQuestionIndex = question?.dataset.questionIndex
    const button = Array.from(document.querySelectorAll('button')).find((item) => /Valider/i.test(item.textContent ?? '') && !item.disabled)

    if (!question || initialQuestionIndex === undefined || !button) {
      reject(new Error('Question courante ou bouton de validation introuvable'))
      return
    }

    const startedAt = performance.now()
    const observer = new MutationObserver(() => {
      const nextQuestionIndex = document.querySelector<HTMLElement>('.question-line')?.dataset.questionIndex
      if (nextQuestionIndex === undefined || nextQuestionIndex === initialQuestionIndex) return
      window.clearTimeout(timeoutId)
      observer.disconnect()
      resolve(performance.now() - startedAt)
    })
    const timeoutId = window.setTimeout(() => {
      observer.disconnect()
      reject(new Error("La question suivante optimiste n'a pas ete affichee"))
    }, 1_000)

    observer.observe(document.body, { attributes: true, characterData: true, childList: true, subtree: true })
    button.click()
  }))
}

async function selectSoloMode(page: Page, mode: 'Sprint' | 'Tempo') {
  await page.getByRole('button', { name: new RegExp(`^${mode}$`, 'i') }).click()
}

async function startSoloSprint(page: Page, durationSeconds = 60) {
  await page.goto(`${APP_URL}/jeu/solo`)
  await page.getByLabel(/Durée Sprint/i).selectOption(String(durationSeconds))
  await page.getByRole('button', { name: /Commencer le sprint|Rejouer le sprint/i }).click()
  await expect(page.locator('.question-line')).toBeVisible()
  await expect(page.getByRole('textbox', { name: /Votre reponse/i })).toBeFocused()
}

async function startSoloTempo(page: Page, perQuestionSeconds = 10) {
  await page.goto(`${APP_URL}/jeu/solo`)
  await selectSoloMode(page, 'Tempo')
  await page.getByLabel(/Temps par question Tempo/i).fill(String(perQuestionSeconds))
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

test('solo sprint joue et finalise une partie complete de bout en bout', async ({ browser, request }, testInfo) => {
  const baselineResponse = await request.get(`${API_URL}/api/dashboard`, {
    headers: { Authorization: 'Bearer e2e:e2e-host' },
  })
  expect(baselineResponse.ok()).toBe(true)
  const baseline = await baselineResponse.json() as { summary: { totalSessions: number } }
  const { context, page } = await e2ePage(browser)
  const browserErrors: string[] = []
  const requestStartedAt = new Map<string, number>()
  const commandResponses: Array<{ path: string; status: number; durationMs: number }> = []

  page.on('pageerror', (error) => browserErrors.push(error.message))
  page.on('request', (outgoingRequest) => {
    const url = new URL(outgoingRequest.url())
    if (outgoingRequest.method() === 'POST' && /\/api\/solo-runs\/[^/]+\/(answers|finish)$/.test(url.pathname)) {
      requestStartedAt.set(`${outgoingRequest.method()}:${url.pathname}`, performance.now())
    }
  })
  page.on('response', (response) => {
    const outgoingRequest = response.request()
    const url = new URL(response.url())
    const key = `${outgoingRequest.method()}:${url.pathname}`
    const startedAt = requestStartedAt.get(key)
    if (startedAt !== undefined) {
      commandResponses.push({
        path: url.pathname,
        status: response.status(),
        durationMs: performance.now() - startedAt,
      })
      requestStartedAt.delete(key)
    }
  })

  try {
    await startSoloSprint(page)

    for (let answerIndex = 0; answerIndex < 3; answerIndex += 1) {
      const question = page.locator('.question-line')
      const questionIndex = await question.getAttribute('data-question-index')
      const prompt = await question.innerText()
      const submittedAnswer = solvePrompt(prompt) + (answerIndex === 2 ? 1 : 0)
      const input = page.getByRole('textbox', { name: /Votre reponse/i })

      await input.fill(String(submittedAnswer))
      await page.getByRole('button', { name: /Valider/i }).click()
      await expect(page.locator('.challenge-run-answer-summary b').first()).toHaveText(String(answerIndex + 1))
      await expect(page.locator('.question-line')).not.toHaveAttribute('data-question-index', questionIndex ?? '')
      await expect(page.getByRole('button', { name: /Valider/i })).toBeEnabled()
    }

    await page.getByRole('button', { name: /Quitter/i }).click()
    await expect(page.getByRole('heading', { name: /Tu progresses/i })).toBeVisible()
    await expect(
      page.locator('.solo-result-metrics > div').filter({ hasText: 'Bonnes réponses' }).locator('dd'),
    ).toHaveText('2/3')
    await expect(page.getByText('Erreur serveur.')).toHaveCount(0)
    await page.screenshot({ path: 'test-results/solo-complete-e2e.png', fullPage: true })

    const dashboardResponse = await request.get(`${API_URL}/api/dashboard`, {
      headers: { Authorization: 'Bearer e2e:e2e-host' },
    })
    expect(dashboardResponse.ok()).toBe(true)
    const dashboard = await dashboardResponse.json() as { summary: { totalSessions: number } }
    expect(dashboard.summary.totalSessions).toBe(baseline.summary.totalSessions + 1)

    const answerResponses = commandResponses.filter((response) => response.path.endsWith('/answers'))
    const finishResponses = commandResponses.filter((response) => response.path.endsWith('/finish'))
    expect(answerResponses).toHaveLength(3)
    expect(answerResponses.every((response) => response.status === 200)).toBe(true)
    expect(finishResponses).toHaveLength(1)
    expect(finishResponses[0]?.status).toBe(200)
    expect(browserErrors).toEqual([])

    console.info(`[performance] solo-browser-commands=${JSON.stringify(commandResponses)}`)
    await testInfo.attach('solo-browser-commands.json', {
      body: JSON.stringify(commandResponses, null, 2),
      contentType: 'application/json',
    })
  } finally {
    await context.close()
  }
})

test('solo tempo finalise sur la derniere reponse sans commande finish concurrente', async ({ browser, request }, testInfo) => {
  const baselineResponse = await request.get(`${API_URL}/api/dashboard`, {
    headers: { Authorization: 'Bearer e2e:e2e-host' },
  })
  expect(baselineResponse.ok()).toBe(true)
  const baseline = await baselineResponse.json() as { summary: { totalSessions: number } }
  const { context, page } = await e2ePage(browser)
  const browserErrors: string[] = []
  const answerDurationsMs: number[] = []
  const answerStartedAt = new Map<string, number>()
  let answerPostCount = 0
  let finishPostCount = 0

  page.on('pageerror', (error) => browserErrors.push(error.message))
  page.on('request', (outgoingRequest) => {
    const url = new URL(outgoingRequest.url())
    if (outgoingRequest.method() !== 'POST') return
    if (/\/api\/solo-runs\/[^/]+\/answers$/.test(url.pathname)) {
      answerPostCount += 1
      answerStartedAt.set(url.pathname, performance.now())
    }
    if (/\/api\/solo-runs\/[^/]+\/finish$/.test(url.pathname)) {
      finishPostCount += 1
    }
  })
  page.on('response', (response) => {
    const url = new URL(response.url())
    const startedAt = answerStartedAt.get(url.pathname)
    if (startedAt !== undefined) {
      answerDurationsMs.push(performance.now() - startedAt)
      answerStartedAt.delete(url.pathname)
    }
  })

  try {
    await page.goto(`${APP_URL}/jeu/solo`)
    await selectSoloMode(page, 'Tempo')
    await page.getByLabel(/Questions Tempo/i).fill('10')
    await page.getByLabel(/Temps par question Tempo/i).fill('30')
    await page.getByRole('button', { name: /Commencer le tempo|Rejouer le tempo/i }).click()
    await expect(page.getByText(/Question 1\/10/i)).toBeVisible()

    for (let answerIndex = 0; answerIndex < 10; answerIndex += 1) {
      const prompt = await page.locator('.question-line').innerText()
      const input = page.getByRole('textbox', { name: /Votre reponse/i })
      await input.fill(String(solvePrompt(prompt)))
      await page.getByRole('button', { name: /Valider/i }).click()

      if (answerIndex < 9) {
        await expect(page.getByText(new RegExp(`Question ${answerIndex + 2}/10`, 'i'))).toBeVisible()
        await expect(page.getByRole('button', { name: /Valider/i })).toBeEnabled()
      }
    }

    await expect(page.getByRole('heading', { name: /Excellent résultat/i })).toBeVisible({ timeout: 15_000 })
    await expect(
      page.locator('.solo-result-metrics > div').filter({ hasText: 'Bonnes réponses' }).locator('dd'),
    ).toHaveText('10/10')
    await page.screenshot({ path: 'test-results/solo-tempo-complete-e2e.png', fullPage: true })

    const dashboardResponse = await request.get(`${API_URL}/api/dashboard`, {
      headers: { Authorization: 'Bearer e2e:e2e-host' },
    })
    expect(dashboardResponse.ok()).toBe(true)
    const dashboard = await dashboardResponse.json() as { summary: { totalSessions: number } }
    expect(dashboard.summary.totalSessions).toBe(baseline.summary.totalSessions + 1)
    expect(answerPostCount).toBe(10)
    expect(finishPostCount).toBe(0)
    expect(browserErrors).toEqual([])

    console.info(`[performance] solo-tempo-answer-acks=${JSON.stringify(answerDurationsMs)}`)
    await testInfo.attach('solo-tempo-answer-acks.json', {
      body: JSON.stringify({ answerDurationsMs, answerPostCount, finishPostCount }, null, 2),
      contentType: 'application/json',
    })
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

test("solo affiche la question suivante apres une reponse juste ou fausse sans attendre l'ACK", async ({ browser }, testInfo) => {
  const { context, page } = await e2ePage(browser)

  try {
    await page.routeWebSocket('**/socket.io/**', (webSocket) => webSocket.close())
    await page.route('**/socket.io/**', (route) => route.abort())
    await page.route('**/api/solo-runs/*/answers', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 350))
      await route.continue()
    })

    await startSoloSprint(page)
    const prompt = await page.locator('.question-line').innerText()
    await page.getByRole('textbox', { name: /Votre reponse/i }).fill(String(solvePrompt(prompt)))

    const correctLatencyMs = await submitAndObserveNextQuestionLatencyMs(page)
    expect(correctLatencyMs).toBeLessThan(ANSWER_UI_CI_BUDGET_MS)

    const input = page.getByRole('textbox', { name: /Votre reponse/i })
    await expect(page.getByRole('button', { name: /En attente/i })).toBeDisabled()
    await input.fill('7')
    await expect(input).toHaveValue('7')
    await expect(page.locator('.challenge-answer-effect.is-correct')).toHaveCount(1)
    await page.screenshot({ path: 'test-results/solo-next-question-optimistic.png', fullPage: true })

    await expect(page.getByRole('button', { name: /Valider/i })).toBeEnabled()
    await expect(input).toHaveValue('7')
    await expect(input).toBeFocused()

    const secondPrompt = await page.locator('.question-line').innerText()
    await input.fill(String(solvePrompt(secondPrompt) + 1))
    const incorrectLatencyMs = await submitAndObserveNextQuestionLatencyMs(page)
    expect(incorrectLatencyMs).toBeLessThan(ANSWER_UI_CI_BUDGET_MS)
    await expect(page.locator('.challenge-answer-effect.is-wrong')).toHaveCount(1)

    await input.fill('9')
    await expect(page.getByRole('button', { name: /Valider/i })).toBeEnabled()
    await expect(input).toHaveValue('9')

    console.info(`[performance] solo-next-question-ui correct=${correctLatencyMs.toFixed(2)}ms incorrect=${incorrectLatencyMs.toFixed(2)}ms`)
    await testInfo.attach('solo-next-question-ui.json', {
      body: JSON.stringify({ correctLatencyMs, incorrectLatencyMs, thresholdMs: ANSWER_UI_CI_BUDGET_MS, serverDelayMs: 350 }, null, 2),
      contentType: 'application/json',
    })
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
