import { expect, type APIRequestContext, type Browser, type Page, type TestInfo, test } from '@playwright/test'
import { waitForRealtimeReady } from './realtime'

const APP_URL = process.env.E2E_APP_URL ?? 'http://127.0.0.1:5173'
const API_URL = process.env.E2E_API_URL ?? 'http://127.0.0.1:4000'
const REALTIME_UI_CI_BUDGET_MS = readRealtimeUiBudgetMs()
const ANSWER_UI_CI_BUDGET_MS = Number(process.env.E2E_ANSWER_UI_BUDGET_MS ?? 50)

if (!Number.isFinite(ANSWER_UI_CI_BUDGET_MS) || ANSWER_UI_CI_BUDGET_MS <= 0) {
  throw new Error('E2E_ANSWER_UI_BUDGET_MS doit etre un nombre strictement positif.')
}

function readRealtimeUiBudgetMs() {
  const value = Number(process.env.E2E_REALTIME_UI_BUDGET_MS ?? 150)

  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('E2E_REALTIME_UI_BUDGET_MS doit etre un nombre strictement positif.')
  }

  return value
}

async function e2ePage(browser: Browser, user: 'host' | 'guest') {
  const context = await browser.newContext()
  await context.addInitScript((value) => {
    try {
      window.localStorage.setItem('mayele.e2e.user', value)
    } catch {
      // Some transient browser documents do not expose localStorage.
    }
  }, user)
  const page = await context.newPage()
  await page.goto(APP_URL)

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

  if (prompt.includes('×') || prompt.toLowerCase().includes('x')) {
    return values[0] * values[1]
  }

  if (prompt.includes('÷') || prompt.includes('/')) {
    return Math.trunc(values[0] / values[1])
  }

  return values[0] + values[1]
}

async function answerOneQuestion(page: Page) {
  const prompt = await page.locator('.question-line').innerText()
  const answer = solvePrompt(prompt)
  await page.getByLabel(/Votre reponse|Votre réponse/i).fill(String(answer))
  await page.getByRole('button', { name: /Valider/i }).click()
}

async function answerOneQuestionAndReturnStartedAtMs(page: Page) {
  const prompt = await page.locator('.question-line').innerText()
  const answer = solvePrompt(prompt)
  await page.getByLabel(/Votre reponse|Votre r.*ponse/i).fill(String(answer))

  return page.evaluate(() => {
    const button = Array.from(document.querySelectorAll('button')).find((item) => {
      return /Valider/i.test(item.textContent ?? '') && !item.disabled
    })

    if (!button) {
      throw new Error('Enabled submit button not found')
    }

    const startedAt = Date.now()
    button.click()
    return startedAt
  })
}

async function answerOneQuestionAndObserveMetricLatencyMs(page: Page, label: string, pattern: string, timeoutMs = 3000) {
  const prompt = await page.locator('.question-line').innerText()
  const answer = solvePrompt(prompt)
  await page.getByLabel(/Votre reponse|Votre r.*ponse/i).fill(String(answer))

  return page.evaluate(
    ({ metricLabel, textPattern, timeout }) =>
      new Promise<number>((resolve, reject) => {
        const regexp = new RegExp(textPattern)
        const matchingMetricValue = () => {
          const metric = Array.from(document.querySelectorAll('.challenge-metrics div')).find((item) => {
            return item.querySelector('span')?.textContent?.trim() === metricLabel
          })

          return metric?.querySelector('strong')?.textContent?.trim() ?? ''
        }
        const button = Array.from(document.querySelectorAll('button')).find((item) => {
          return /Valider/i.test(item.textContent ?? '') && !item.disabled
        })

        if (!button) {
          reject(new Error('Enabled submit button not found'))
          return
        }

        const startedAt = performance.now()
        let observer: MutationObserver | null = null
        const timeoutId = window.setTimeout(() => {
          observer?.disconnect()
          reject(new Error(`Metric ${metricLabel} did not match ${textPattern}`))
        }, timeout)
        const resolveIfMatched = () => {
          if (!regexp.test(matchingMetricValue())) {
            return
          }

          window.clearTimeout(timeoutId)
          observer?.disconnect()
          resolve(performance.now() - startedAt)
        }

        observer = new MutationObserver(resolveIfMatched)
        observer.observe(document.body, {
          characterData: true,
          childList: true,
          subtree: true,
        })

        button.click()
        resolveIfMatched()
      }),
    { metricLabel: label, textPattern: pattern, timeout: timeoutMs },
  )
}

async function readSprintTimer(page: Page) {
  return readChallengeTimer(page)
}

async function readChallengeTimer(page: Page) {
  const value = await page.getByLabel(/Temps restant/i).locator('strong').innerText()
  return Number(value)
}

async function readChallengeProgressLabel(page: Page) {
  return page.locator('.challenge-progress strong').innerText()
}

function multiplayerLobby(page: Page) {
  return page.locator('.multiplayer-lobby-grid')
}

function createRoomButton(page: Page) {
  return page.locator('.multiplayer-lobby-card .primary-button')
}

function proposeChallengeButton(page: Page) {
  return page.getByRole('button', { name: /Proposer le defi/i })
}

async function proposeChallenge(page: Page) {
  const button = proposeChallengeButton(page)
  await expect(button).toBeEnabled()
  await button.click()
}

async function createInvitedRoom(browser: Browser, request: APIRequestContext) {
  const reset = await request.post(`${API_URL}/api/e2e/reset-multiplayer`)
  expect(reset.ok()).toBeTruthy()

  const host = await e2ePage(browser, 'host')
  const guest = await e2ePage(browser, 'guest')

  await host.page.goto(`${APP_URL}/jeu/multijoueur`)
  await guest.page.goto(`${APP_URL}/jeu/multijoueur`)
  await Promise.all([waitForRealtimeReady(host.page), waitForRealtimeReady(guest.page)])

  await expect(host.page.getByRole('button', { name: /Bob Guest/i })).toBeVisible()
  await host.page.getByRole('button', { name: /Bob Guest/i }).click()
  await expect(host.page).toHaveURL(/match=/)
  await expect(host.page.getByRole('button', { name: /Annuler l'invitation/i })).toBeVisible()
  await waitForRealtimeReady(host.page)

  return { host, guest }
}

async function createAcceptedRoom(browser: Browser, request: APIRequestContext) {
  const { host, guest } = await createInvitedRoom(browser, request)

  await guest.page.goto(host.page.url())
  await waitForRealtimeReady(guest.page)
  await guest.page.getByRole('button', { name: /Entrer dans le salon/i }).click()

  await expect(host.page.getByRole('button', { name: /Fermer le salon/i })).toBeVisible()
  await expect(guest.page.getByText(/En attente du maitre du salon/i).first()).toBeVisible()

  return { host, guest }
}

async function createCompletedRoom(browser: Browser, request: APIRequestContext) {
  const reset = await request.post(`${API_URL}/api/e2e/reset-multiplayer`)
  expect(reset.ok()).toBeTruthy()

  const completed = await request.post(`${API_URL}/api/e2e/completed-match`)
  expect(completed.ok()).toBeTruthy()
  const payload = await completed.json() as { match: { id: string } }
  const host = await e2ePage(browser, 'host')
  const guest = await e2ePage(browser, 'guest')
  const matchUrl = `${APP_URL}/jeu/multijoueur?match=${payload.match.id}`

  await host.page.goto(matchUrl)
  await guest.page.goto(matchUrl)
  await expect(host.page.getByRole('button', { name: /^Rejouer ce duel$/i })).toBeVisible()
  await expect(guest.page.getByRole('button', { name: /^Rejouer ce duel$/i })).toBeVisible()

  return { host, guest }
}

async function startTempoMatch(host: Page, guest: Page, perQuestionSeconds = 10) {
  await host.getByRole('button', { name: /Tempo/i }).click()
  await host.getByRole('button', { name: /Addition/i }).click()
  await host.getByRole('button', { name: /butant/i }).click()
  await host.getByLabel(/Questions/i).fill('10')
  await host.getByLabel(/Secondes par question|Temps par question/i).fill(String(perQuestionSeconds))
  await proposeChallenge(host)
  await guest.getByRole('button', { name: /Accepter le defi/i }).click()
  await expect(host.locator('.question-line')).toBeVisible()
  await expect(guest.locator('.question-line')).toBeVisible()
}

async function startSprintMatch(host: Page, guest: Page) {
  await host.getByRole('button', { name: /Sprint/i }).click()
  await host.getByRole('button', { name: /Addition/i }).click()
  await host.getByRole('button', { name: /butant/i }).click()
  await proposeChallenge(host)
  await expect(guest.getByRole('button', { name: /Accepter le defi/i })).toBeVisible()
  await guest.getByRole('button', { name: /Accepter le defi/i }).click()
  await expect(host.locator('.question-line')).toBeVisible()
  await expect(guest.locator('.question-line')).toBeVisible()
}


function roomStopButton(page: Page) {
  return page.locator('.multiplayer-room-state').getByRole('button', { name: /^Stop$/i })
}

async function expectClosedRoomLobby(page: Page) {
  await expect(multiplayerLobby(page)).toBeVisible()
  await expect(page.locator('.multiplayer-room-grid')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Rejouer ce duel$/i })).toHaveCount(0)
}

async function expectForfeitResult(
  forfeitingPage: Page,
  winningPage: Page,
  options: { screenshotName: string; expectAnsweredStats?: boolean },
) {
  for (const page of [forfeitingPage, winningPage]) {
    await expect(page).toHaveURL(/match=/)
    await expect(page.locator('.multiplayer-result-panel')).toBeVisible()
    await expect(multiplayerLobby(page)).toHaveCount(0)
    await expect(page.locator('.question-line')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Rejouer ce duel$/i })).toBeVisible()
  }

  await expect(forfeitingPage.locator('[data-result-player="self"]')).toHaveAttribute('data-result-outcome', 'loser')
  await expect(forfeitingPage.locator('[data-result-player="self"]')).toHaveAttribute('data-forfeited', 'true')
  await expect(forfeitingPage.locator('[data-result-player="self"] .multiplayer-result-forfeit-badge')).toHaveText(/Abandon/i)
  await expect(forfeitingPage.locator('[data-result-player="opponent"]')).toHaveAttribute('data-result-outcome', 'winner')
  await expect(forfeitingPage.locator('[data-result-player="opponent"]')).toHaveAttribute('data-forfeited', 'false')

  await expect(winningPage.locator('[data-result-player="self"]')).toHaveAttribute('data-result-outcome', 'winner')
  await expect(winningPage.locator('[data-result-player="self"]')).toHaveAttribute('data-forfeited', 'false')
  await expect(winningPage.locator('[data-result-player="opponent"]')).toHaveAttribute('data-result-outcome', 'loser')
  await expect(winningPage.locator('[data-result-player="opponent"]')).toHaveAttribute('data-forfeited', 'true')
  await expect(winningPage.locator('[data-result-player="opponent"] .multiplayer-result-forfeit-badge')).toHaveText(/Abandon/i)

  if (options.expectAnsweredStats) {
    await expect(forfeitingPage.locator('[data-result-player="self"] .multiplayer-result-stats strong').first()).toContainText('1/1')
    await expect(forfeitingPage.locator('[data-result-player="opponent"] .multiplayer-result-stats strong').first()).toContainText('1/1')
    await expect(winningPage.locator('[data-result-player="self"] .multiplayer-result-stats strong').first()).toContainText('1/1')
    await expect(winningPage.locator('[data-result-player="opponent"] .multiplayer-result-stats strong').first()).toContainText('1/1')
  }

  await forfeitingPage.screenshot({ path: `test-results/${options.screenshotName}-forfeiter.png`, fullPage: true })
  await winningPage.screenshot({ path: `test-results/${options.screenshotName}-winner.png`, fullPage: true })

  await forfeitingPage.getByRole('button', { name: /^Rejouer ce duel$/i }).click()
  await expect(forfeitingPage.getByRole('button', { name: /Relance demand/i })).toBeVisible()
  await expect(winningPage.getByText(/Relance demand/i).first()).toBeVisible()
}

async function expectActiveOperation(page: Page, operationName: RegExp) {
  await expect(page.getByRole('button', { name: operationName })).toHaveClass(/active/)
}

async function expectLaunchIdleAnimation(page: Page, label: string) {
  const button = page.locator('button').filter({ hasText: label }).first()
  await expect(button).toBeVisible()
  const animationNames = await button.evaluate((element) => (
    element.getAnimations({ subtree: true }).map((animation) => (
      animation instanceof CSSAnimation ? animation.animationName : ''
    ))
  ))
  expect(animationNames).toContain('launch-action-breathe')
}

async function clickButtonInPageAndReturnEpochMs(page: Page, label: string) {
  const button = page.locator('button').filter({ hasText: label }).first()
  await expect(button).toBeVisible()

  const startedAt = button.evaluate((element) => new Promise<number>((resolve) => {
    element.addEventListener('click', () => resolve(Date.now()), { capture: true, once: true })
  }))
  await button.click()
  return startedAt
}

async function observeActiveButtonEpochMs(page: Page, label: string, timeoutMs = 3000) {
  const button = page.locator('button').filter({ hasText: label }).first()
  await expect(button).toHaveClass(/active/, { timeout: timeoutMs })
  return Date.now()
}

async function observeTextEpochMs(page: Page, pattern: string, timeoutMs = 3000) {
  return page.evaluate(
    ({ source, timeout }) =>
      new Promise<number>((resolve, reject) => {
        const expression = new RegExp(source, 'i')
        const isVisible = (element: Element) => {
          const style = window.getComputedStyle(element)
          return style.visibility !== 'hidden' && style.display !== 'none' && element.getClientRects().length > 0
        }
        const isObserved = () => Array.from(document.querySelectorAll('body *')).some((element) => {
          return isVisible(element) && expression.test(element.textContent ?? '')
        })
        const resolveIfObserved = () => {
          if (!isObserved()) {
            return
          }

          window.clearTimeout(timeoutId)
          observer.disconnect()
          resolve(Date.now())
        }
        const timeoutId = window.setTimeout(() => {
          observer.disconnect()
          reject(new Error(`Text ${source} not observed`))
        }, timeout)
        const observer = new MutationObserver(resolveIfObserved)

        observer.observe(document.body, { characterData: true, childList: true, subtree: true })
        resolveIfObserved()
      }),
    { source: pattern, timeout: timeoutMs },
  )
}

async function observeSelectorEpochMs(page: Page, selector: string, timeoutMs = 3000) {
  await expect(page.locator(selector).first()).toBeVisible({ timeout: timeoutMs })
  return Date.now()
}

async function observeSelectorTextEpochMs(page: Page, selector: string, pattern: string, timeoutMs = 3000) {
  const matchingElement = page.locator(selector).filter({ hasText: new RegExp(pattern, 'i') }).first()
  await expect(matchingElement).toBeVisible({ timeout: timeoutMs })
  return Date.now()
}

async function waitForEnabledSubmit(page: Page, timeoutMs = 3000) {
  return page.evaluate(
    (timeout) =>
      new Promise<number>((resolve, reject) => {
        const hasEnabledSubmit = () => {
          return Array.from(document.querySelectorAll('button')).some((item) => {
            return /Valider/i.test(item.textContent ?? '') && !item.disabled
          })
        }

        if (hasEnabledSubmit()) {
          resolve(Date.now())
          return
        }

        const timeoutId = window.setTimeout(() => {
          observer.disconnect()
          reject(new Error('Enabled submit button not observed'))
        }, timeout)
        const observer = new MutationObserver(() => {
          if (!hasEnabledSubmit()) {
            return
          }

          window.clearTimeout(timeoutId)
          observer.disconnect()
          resolve(Date.now())
        })

        observer.observe(document.body, {
          attributes: true,
          childList: true,
          subtree: true,
        })
      }),
    timeoutMs,
  )
}

async function attachLatencyMetric(testInfo: TestInfo, name: string, latencyMs: number, thresholdMs = REALTIME_UI_CI_BUDGET_MS) {
  await testInfo.attach(`${name}.json`, {
    body: JSON.stringify({ name, latencyMs, thresholdMs }, null, 2),
    contentType: 'application/json',
  })
}

async function attachRealtimeMetric(testInfo: TestInfo, name: string, payload: Record<string, unknown>) {
  await testInfo.attach(`${name}.json`, {
    body: JSON.stringify({ name, ...payload }, null, 2),
    contentType: 'application/json',
  })
}

async function observeActiveButton(page: Page, names: string[], durationMs = 1000) {
  return page.evaluate(
    ({ labels, duration }) =>
      new Promise<string[]>((resolve) => {
        const values: string[] = []
        const startedAt = performance.now()

        const sample = () => {
          const active = labels.find((label) => {
            const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.includes(label))
            return button?.classList.contains('active')
          })

          values.push(active ?? 'none')

          if (performance.now() - startedAt >= duration) {
            resolve(values)
            return
          }

          requestAnimationFrame(sample)
        }

        sample()
      }),
    { labels: names, duration: durationMs },
  )
}

test("recupere automatiquement l'arene apres une erreur serveur transitoire", async ({ browser, request }) => {
  const reset = await request.post(`${API_URL}/api/e2e/reset-multiplayer`)
  expect(reset.ok()).toBeTruthy()

  const host = await e2ePage(browser, 'host')
  let overviewAttempts = 0

  try {
    await host.page.route('**/api/matches/room-overview', async (route) => {
      overviewAttempts += 1

      if (overviewAttempts === 1) {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Erreur serveur.', code: 'internal_error' }),
        })
        return
      }

      await route.continue()
    })

    await host.page.goto(`${APP_URL}/jeu/multijoueur`)
    await expect(multiplayerLobby(host.page)).toBeVisible()
    await expect.poll(() => overviewAttempts).toBeGreaterThanOrEqual(2)
    await expect(host.page.getByText('Erreur serveur.')).toHaveCount(0)
  } finally {
    await host.context.close()
  }
})

test('latence invitation et notification dans le budget realtime CI', async ({ browser, request }, testInfo) => {
  test.setTimeout(45_000)

  const reset = await request.post(`${API_URL}/api/e2e/reset-multiplayer`)
  expect(reset.ok()).toBeTruthy()

  const host = await e2ePage(browser, 'host')
  const guest = await e2ePage(browser, 'guest')

  try {
    let createChallengeRestRequests = 0
    host.page.on('request', (pageRequest) => {
      if (pageRequest.url().includes('/api/matches/challenges')) {
        createChallengeRestRequests += 1
      }
    })

    await host.page.goto(`${APP_URL}/jeu/multijoueur`)
    await guest.page.goto(`${APP_URL}/jeu/multijoueur`)
    await Promise.all([waitForRealtimeReady(host.page), waitForRealtimeReady(guest.page)])
    await expect(multiplayerLobby(guest.page)).toBeVisible()
    await expect(guest.page.locator('.notification-center')).toBeVisible()
    await expect(host.page.getByRole('button', { name: /Bob Guest/i })).toBeVisible()

    const guestInviteSeenAtPromise = observeSelectorTextEpochMs(guest.page, '.multiplayer-challenge-list', 'Alice Host', 3000)
    const notificationSeenAtPromise = observeSelectorTextEpochMs(guest.page, '.notification-center, .floating-toast-stack', '1|vous a defie|vous a defi', 5000)
    const hostStartedAt = await clickButtonInPageAndReturnEpochMs(host.page, 'Bob Guest')
    const [guestInviteSeenAt, notificationSeenAt] = await Promise.all([guestInviteSeenAtPromise, notificationSeenAtPromise])
    const inviteListLatencyMs = guestInviteSeenAt - hostStartedAt
    const notificationLatencyMs = notificationSeenAt - hostStartedAt

    await attachRealtimeMetric(testInfo, 'realtime-invite-summary', { inviteListLatencyMs, notificationLatencyMs })
    await attachLatencyMetric(testInfo, 'realtime-invite-room-card', inviteListLatencyMs, REALTIME_UI_CI_BUDGET_MS)
    await attachLatencyMetric(testInfo, 'realtime-invite-notification', notificationLatencyMs, REALTIME_UI_CI_BUDGET_MS)
    await guest.page.screenshot({ path: 'test-results/realtime-invite-notification-under-budget-guest.png', fullPage: true })

    expect(inviteListLatencyMs).toBeLessThan(REALTIME_UI_CI_BUDGET_MS)
    expect(notificationLatencyMs).toBeLessThan(REALTIME_UI_CI_BUDGET_MS)
    await expect(host.page).toHaveURL(/match=/)
    expect(createChallengeRestRequests).toBe(0)
  } finally {
    await host.context.close()
    await guest.context.close()
  }
})

test('latence entree salon dans le budget realtime CI', async ({ browser, request }, testInfo) => {
  test.setTimeout(45_000)

  const { host, guest } = await createInvitedRoom(browser, request)

  try {
    let acceptRestRequests = 0
    guest.page.on('request', (pageRequest) => {
      if (pageRequest.url().includes('/api/matches/') && pageRequest.url().endsWith('/accept')) {
        acceptRestRequests += 1
      }
    })

    await guest.page.goto(host.page.url())
    await expect(guest.page.getByRole('button', { name: /Entrer dans le salon/i })).toBeVisible()

    const hostSeenAtPromise = observeTextEpochMs(host.page, 'Fermer le salon')
    const guestStartedAt = await clickButtonInPageAndReturnEpochMs(guest.page, 'Entrer dans le salon')
    const hostSeenAt = await hostSeenAtPromise
    const latencyMs = hostSeenAt - guestStartedAt

    await attachRealtimeMetric(testInfo, 'realtime-room-enter-summary', { latencyMs, acceptRestRequests })
    await attachLatencyMetric(testInfo, 'realtime-room-enter', latencyMs, REALTIME_UI_CI_BUDGET_MS)
    await host.page.screenshot({ path: 'test-results/realtime-room-enter-under-budget-host.png', fullPage: true })

    expect(latencyMs).toBeLessThan(REALTIME_UI_CI_BUDGET_MS)
    await guest.page.waitForTimeout(500)
    expect(acceptRestRequests).toBe(0)
  } finally {
    await host.context.close()
    await guest.context.close()
  }
})

test("refuser une invitation ferme l'attente pour l'hote et l'invite via realtime", async ({ browser, request }) => {
  test.setTimeout(45_000)

  const { host, guest } = await createInvitedRoom(browser, request)

  try {
    let declineRestRequests = 0

    guest.page.on('request', (pageRequest) => {
      if (pageRequest.url().includes('/api/matches/') && pageRequest.url().endsWith('/decline')) {
        declineRestRequests += 1
      }
    })

    await guest.page.goto(host.page.url())
    await expect(guest.page.getByRole('button', { name: /Entrer dans le salon/i })).toBeVisible()
    await guest.page.getByRole('button', { name: /^Refuser$/i }).click()

    await expectClosedRoomLobby(host.page)
    await expectClosedRoomLobby(guest.page)
    await guest.page.waitForTimeout(200)
    expect(declineRestRequests).toBe(0)

    await host.page.screenshot({ path: 'test-results/decline-invitation-host-lobby.png', fullPage: true })
    await guest.page.screenshot({ path: 'test-results/decline-invitation-guest-lobby.png', fullPage: true })
  } finally {
    await host.context.close()
    await guest.context.close()
  }
})

test("refuser une invitation depuis la liste des defis recus ferme l'attente sans ouvrir le salon", async ({ browser, request }) => {
  test.setTimeout(45_000)

  const { host, guest } = await createInvitedRoom(browser, request)

  try {
    let declineRestRequests = 0

    guest.page.on('request', (pageRequest) => {
      if (pageRequest.url().includes('/api/matches/') && pageRequest.url().endsWith('/decline')) {
        declineRestRequests += 1
      }
    })

    await expect(guest.page).toHaveURL(/\/jeu\/multijoueur$/)
    await expect(guest.page.locator('.multiplayer-challenge-list')).toContainText('Alice Host')
    await expect(guest.page.locator('.multiplayer-challenge-list .multiplayer-invitation-decline')).toBeVisible()
    await guest.page.locator('.multiplayer-challenge-list .multiplayer-invitation-decline').click()

    await expectClosedRoomLobby(host.page)
    await expectClosedRoomLobby(guest.page)
    await expect(guest.page.locator('.multiplayer-challenge-list')).toContainText(/Aucun defi|Aucun d.*fi|Rien en attente/i)
    await guest.page.waitForTimeout(200)
    expect(declineRestRequests).toBe(0)

    await host.page.screenshot({ path: 'test-results/decline-invitation-from-lobby-host.png', fullPage: true })
    await guest.page.screenshot({ path: 'test-results/decline-invitation-from-lobby-guest.png', fullPage: true })
  } finally {
    await host.context.close()
    await guest.context.close()
  }
})

test('latence proposition et acceptation defi dans le budget realtime CI', async ({ browser, request }, testInfo) => {
  test.setTimeout(45_000)

  const { host, guest } = await createAcceptedRoom(browser, request)

  try {
    let proposeRestRequests = 0
    let acceptProposalRestRequests = 0

    host.page.on('request', (pageRequest) => {
      if (pageRequest.url().includes('/api/matches/') && pageRequest.url().endsWith('/propose')) {
        proposeRestRequests += 1
      }
    })
    guest.page.on('request', (pageRequest) => {
      if (pageRequest.url().includes('/api/matches/') && pageRequest.url().includes('/proposal/accept')) {
        acceptProposalRestRequests += 1
      }
    })

    await host.page.getByRole('button', { name: /Tempo/i }).click()
    await host.page.getByRole('button', { name: /Addition/i }).click()
    await host.page.getByRole('button', { name: /butant/i }).click()
    await host.page.getByLabel(/Questions/i).fill('10')

    const guestProposalSeenAtPromise = observeTextEpochMs(guest.page, 'Accepter le defi')
    await expect(proposeChallengeButton(host.page)).toBeEnabled()
    await expectLaunchIdleAnimation(host.page, 'Proposer le defi')
    const hostProposalStartedAt = await clickButtonInPageAndReturnEpochMs(host.page, 'Proposer le defi')
    const guestProposalSeenAt = await guestProposalSeenAtPromise
    const proposalLatencyMs = guestProposalSeenAt - hostProposalStartedAt

    const hostStartedSeenAtPromise = observeSelectorEpochMs(host.page, '.question-line')
    await expectLaunchIdleAnimation(guest.page, 'Accepter le defi')
    const guestAcceptStartedAt = await clickButtonInPageAndReturnEpochMs(guest.page, 'Accepter le defi')
    await expect(guest.page.locator('.launch-action-burst')).toBeVisible()
    await guest.page.screenshot({ path: 'test-results/multiplayer-launch-animation.png', fullPage: true })
    const hostStartedSeenAt = await hostStartedSeenAtPromise
    const startLatencyMs = hostStartedSeenAt - guestAcceptStartedAt

    await attachRealtimeMetric(testInfo, 'realtime-proposal-summary', {
      proposalLatencyMs,
      startLatencyMs,
      proposeRestRequests,
      acceptProposalRestRequests,
    })
    await attachLatencyMetric(testInfo, 'realtime-propose-challenge', proposalLatencyMs, REALTIME_UI_CI_BUDGET_MS)
    await attachLatencyMetric(testInfo, 'realtime-accept-proposal-start', startLatencyMs, REALTIME_UI_CI_BUDGET_MS)
    await host.page.screenshot({ path: 'test-results/realtime-proposal-start-under-budget-host.png', fullPage: true })

    expect(proposalLatencyMs).toBeLessThan(REALTIME_UI_CI_BUDGET_MS)
    expect(startLatencyMs).toBeLessThan(REALTIME_UI_CI_BUDGET_MS)
    await guest.page.waitForTimeout(200)
    expect(proposeRestRequests).toBe(0)
    expect(acceptProposalRestRequests).toBe(0)
    await expect(host.page.getByText(/Commande de configuration de defi invalide|authentification|auth requise/i)).toHaveCount(0)
    await expect(guest.page.getByText(/Commande de configuration de defi invalide|authentification|auth requise/i)).toHaveCount(0)
    await expect(host.page.locator('.question-line')).toBeVisible()
    await expect(guest.page.locator('.question-line')).toBeVisible()
  } finally {
    await host.context.close()
    await guest.context.close()
  }
})

for (const sprintDuration of [60, 90, 120] as const) {
  test(`Sprint ${sprintDuration} secondes demarre avec timer et progression bornes apres un passage par Tempo`, async ({ browser, request }) => {
    test.setTimeout(45_000)

    const { host, guest } = await createAcceptedRoom(browser, request)

    try {
      await test.step('configurer puis synchroniser Tempo', async () => {
        const tempoButton = host.page.locator('.multiplayer-config-mode').getByRole('button', { name: /Tempo/i })
        await expect(tempoButton).toBeVisible()
        await expect(tempoButton).toBeEnabled()
        await tempoButton.click({ timeout: 5_000 })
        await host.page.getByRole('button', { name: /Addition/i }).click({ timeout: 5_000 })
        await host.page.getByRole('button', { name: /butant/i }).click({ timeout: 5_000 })
        await host.page.getByLabel(/Questions/i).fill('10', { timeout: 5_000 })
        await host.page.getByLabel(/Secondes par question|Temps par question/i).fill('10', { timeout: 5_000 })
        await test.step('l hote conserve Tempo', async () => {
          await expect(host.page.getByRole('button', { name: /Tempo/i })).toHaveClass(/active/, { timeout: 5_000 })
        })
        await test.step('l invite recoit Tempo', async () => {
          await expect(guest.page.getByRole('button', { name: /Tempo/i })).toHaveClass(/active/, { timeout: 5_000 })
        })
      })

      await test.step('basculer puis synchroniser Sprint', async () => {
        await host.page.getByRole('button', { name: /Sprint/i }).click()
        await expect(host.page.getByRole('button', { name: /Sprint/i })).toHaveClass(/active/)
        await expect(guest.page.getByRole('button', { name: /Sprint/i })).toHaveClass(/active/)
        await host.page.getByLabel(/Duree|Dur.*e/i).selectOption(String(sprintDuration))
        await expect(host.page.getByLabel(/Duree|Dur.*e/i)).toHaveValue(String(sprintDuration))
      })

      await test.step('proposer et demarrer le Sprint', async () => {
        await proposeChallenge(host.page)
        await expect(guest.page.getByRole('button', { name: /Accepter le defi/i })).toBeVisible()
        await guest.page.getByRole('button', { name: /Accepter le defi/i }).click()
        await expect(host.page.locator('.question-line')).toBeVisible()
        await expect(guest.page.locator('.question-line')).toBeVisible()
      })

      await expect.poll(() => readSprintTimer(host.page)).toBeLessThanOrEqual(sprintDuration)
      await expect.poll(() => readSprintTimer(guest.page)).toBeLessThanOrEqual(sprintDuration)
      await expect.poll(() => readChallengeProgressLabel(host.page)).toMatch(new RegExp(`/${sprintDuration}$`))
      await expect.poll(() => readChallengeProgressLabel(guest.page)).toMatch(new RegExp(`/${sprintDuration}$`))

      await host.page.screenshot({ path: `test-results/sprint-${sprintDuration}-after-tempo-host.png`, fullPage: true })
      await guest.page.screenshot({ path: `test-results/sprint-${sprintDuration}-after-tempo-guest.png`, fullPage: true })
    } finally {
      await host.context.close()
      await guest.context.close()
    }
  })
}

test('Sprint multijoueur valide localement une reponse en quelques millisecondes', async ({ browser, request }, testInfo) => {
  test.setTimeout(45_000)

  const { host, guest } = await createAcceptedRoom(browser, request)

  try {
    await host.page.getByRole('button', { name: /Sprint/i }).click()
    await host.page.getByRole('button', { name: /Addition/i }).click()
    await host.page.getByRole('button', { name: /butant/i }).click()
    await proposeChallenge(host.page)
    await guest.page.getByRole('button', { name: /Accepter le defi/i }).click()
    await expect(host.page.locator('.question-line')).toBeVisible()
    await host.page.evaluate(() => {
      document.body.dataset.haloAnimationCount = '0'
      document.addEventListener('animationstart', (event) => {
        const target = event.target
        if (!(target instanceof HTMLElement) || !target.classList.contains('challenge-answer-effect')) return
        const count = Number(document.body.dataset.haloAnimationCount ?? 0)
        document.body.dataset.haloAnimationCount = String(count + 1)
      })
    })

    const latencyMs = await answerOneQuestionAndObserveMetricLatencyMs(host.page, 'Score', '^[1-9][0-9]*$')

    console.info(`[performance] multiplayer-sprint-answer-ui=${latencyMs.toFixed(2)}ms`)
    await attachLatencyMetric(testInfo, 'realtime-sprint-answer-ui', latencyMs, ANSWER_UI_CI_BUDGET_MS)
    expect(latencyMs).toBeLessThan(ANSWER_UI_CI_BUDGET_MS)
    await expect(host.page.getByRole('textbox', { name: /Votre reponse|Votre r.*ponse/i })).toBeFocused()
    await expect.poll(() => host.page.locator('body').getAttribute('data-halo-animation-count')).toBe('1')
    await expect(host.page.locator('.question-line')).toHaveAttribute('data-question-index', '1')

    await answerOneQuestion(host.page)
    await expect.poll(() => host.page.locator('body').getAttribute('data-halo-animation-count')).toBe('2')
  } finally {
    await host.context.close()
    await guest.context.close()
  }
})

for (const tempoSeconds of [5, 30] as const) {
  test(`Tempo demarre avec ${tempoSeconds} secondes par question`, async ({ browser, request }) => {
    test.setTimeout(45_000)

    const { host, guest } = await createAcceptedRoom(browser, request)

    try {
      await host.page.getByRole('button', { name: /Tempo/i }).click()
      await host.page.getByRole('button', { name: /Addition/i }).click()
      await host.page.getByRole('button', { name: /butant/i }).click()
      await host.page.getByLabel(/Questions/i).fill('10')
      await host.page.getByLabel(/Secondes par question|Temps par question/i).fill(String(tempoSeconds))
      await expect(host.page.getByLabel(/Secondes par question|Temps par question/i)).toHaveValue(String(tempoSeconds))
      await expect(guest.page.getByRole('button', { name: /Tempo/i })).toHaveClass(/active/)

      await proposeChallenge(host.page)
      await expect(guest.page.getByRole('button', { name: /Accepter le defi/i })).toBeVisible()
      await guest.page.getByRole('button', { name: /Accepter le defi/i }).click()
      await expect(host.page.locator('.question-line')).toBeVisible()
      await expect(guest.page.locator('.question-line')).toBeVisible()

      await expect.poll(() => readChallengeTimer(host.page)).toBeLessThanOrEqual(tempoSeconds)
      await expect.poll(() => readChallengeTimer(guest.page)).toBeLessThanOrEqual(tempoSeconds)
      await expect.poll(() => readChallengeProgressLabel(host.page)).toMatch(new RegExp(`/${tempoSeconds}$`))
      await expect.poll(() => readChallengeProgressLabel(guest.page)).toMatch(new RegExp(`/${tempoSeconds}$`))
      if (tempoSeconds === 30) {
        await expect(host.page.locator('.challenge-arena')).not.toHaveClass(/is-critical/)
        await expect(guest.page.locator('.challenge-arena')).not.toHaveClass(/is-critical/)
      }

      await host.page.screenshot({ path: `test-results/tempo-${tempoSeconds}-seconds-host.png`, fullPage: true })
      await guest.page.screenshot({ path: `test-results/tempo-${tempoSeconds}-seconds-guest.png`, fullPage: true })
    } finally {
      await host.context.close()
      await guest.context.close()
    }
  })
}

test('refuser une proposition remet les deux joueurs en salon configurable via realtime', async ({ browser, request }, testInfo) => {
  test.setTimeout(45_000)

  const { host, guest } = await createAcceptedRoom(browser, request)

  try {
    let declineProposalRestRequests = 0

    guest.page.on('request', (pageRequest) => {
      if (pageRequest.url().includes('/api/matches/') && pageRequest.url().includes('/proposal/decline')) {
        declineProposalRestRequests += 1
      }
    })

    await host.page.getByRole('button', { name: /Tempo/i }).click()
    await host.page.getByRole('button', { name: /Addition/i }).click()
    await host.page.getByRole('button', { name: /butant/i }).click()
    await host.page.getByLabel(/Questions/i).fill('10')
    await proposeChallenge(host.page)
    await expect(guest.page.getByRole('button', { name: /Accepter le defi/i })).toBeVisible()

    const hostConfigurableAgainPromise = observeTextEpochMs(host.page, 'Proposer le defi')
    const guestWaitingAgainPromise = observeSelectorTextEpochMs(guest.page, '.multiplayer-room-state', 'En attente du maitre du salon')
    const guestStartedAt = await clickButtonInPageAndReturnEpochMs(guest.page, 'Refuser')
    const [hostConfigurableAgainAt, guestWaitingAgainAt] = await Promise.all([hostConfigurableAgainPromise, guestWaitingAgainPromise])
    const hostLatencyMs = hostConfigurableAgainAt - guestStartedAt
    const guestLatencyMs = guestWaitingAgainAt - guestStartedAt

    await attachRealtimeMetric(testInfo, 'realtime-decline-proposal-summary', {
      hostLatencyMs,
      guestLatencyMs,
      declineProposalRestRequests,
    })
    await attachLatencyMetric(testInfo, 'realtime-decline-proposal-host', hostLatencyMs, REALTIME_UI_CI_BUDGET_MS)
    await attachLatencyMetric(testInfo, 'realtime-decline-proposal-guest', guestLatencyMs, REALTIME_UI_CI_BUDGET_MS)

    expect(hostLatencyMs).toBeLessThan(REALTIME_UI_CI_BUDGET_MS)
    expect(guestLatencyMs).toBeLessThan(REALTIME_UI_CI_BUDGET_MS)
    await expect(host.page.getByRole('button', { name: /Proposer le defi/i })).toBeEnabled()
    await expect(guest.page.getByRole('button', { name: /Accepter le defi/i })).toHaveCount(0)
    await expect(guest.page.getByRole('button', { name: /^Refuser$/i })).toHaveCount(0)
    await guest.page.waitForTimeout(200)
    expect(declineProposalRestRequests).toBe(0)

    await host.page.screenshot({ path: 'test-results/decline-proposal-host-configurable.png', fullPage: true })
    await guest.page.screenshot({ path: 'test-results/decline-proposal-guest-waiting.png', fullPage: true })
  } finally {
    await host.context.close()
    await guest.context.close()
  }
})

test('quitter le salon cote hote ferme la session pour les deux joueurs', async ({ browser, request }) => {
  test.setTimeout(45_000)

  const { host, guest } = await createAcceptedRoom(browser, request)

  try {
    await host.page.getByRole('button', { name: /Fermer le salon/i }).click()
    await expectClosedRoomLobby(host.page)
    await expectClosedRoomLobby(guest.page)
    await host.page.screenshot({ path: 'test-results/quit-room-host-closes-both-host.png', fullPage: true })
    await guest.page.screenshot({ path: 'test-results/quit-room-host-closes-both-guest.png', fullPage: true })
  } finally {
    await host.context.close()
    await guest.context.close()
  }
})

test('quitter le salon cote invite ferme la session pour les deux joueurs', async ({ browser, request }) => {
  test.setTimeout(45_000)

  const { host, guest } = await createAcceptedRoom(browser, request)

  try {
    await guest.page.getByRole('button', { name: /Quitter le salon/i }).click()
    await expectClosedRoomLobby(host.page)
    await expectClosedRoomLobby(guest.page)
    await host.page.screenshot({ path: 'test-results/quit-room-guest-closes-both-host.png', fullPage: true })
    await guest.page.screenshot({ path: 'test-results/quit-room-guest-closes-both-guest.png', fullPage: true })
  } finally {
    await host.context.close()
    await guest.context.close()
  }
})

test('latence realtime configuration du salon dans le budget CI avec preuve visuelle', async ({ browser, request }, testInfo) => {
  test.setTimeout(45_000)

  const { host, guest } = await createAcceptedRoom(browser, request)

  try {
    let hostConfigRequests = 0
    host.page.on('request', (pageRequest) => {
      if (pageRequest.url().includes('/api/matches/') && pageRequest.url().includes('/config')) {
        hostConfigRequests += 1
      }
    })
    await expect(guest.page.getByRole('button', { name: /Tempo/i })).not.toHaveClass(/active/)

    const guestSeenAtPromise = observeActiveButtonEpochMs(guest.page, 'Tempo')
    const hostAckSeenAtPromise = observeActiveButtonEpochMs(host.page, 'Tempo')
    const hostStartedAt = await clickButtonInPageAndReturnEpochMs(host.page, 'Tempo')
    const hostAckSeenAt = await hostAckSeenAtPromise
    const guestSeenAt = await guestSeenAtPromise
    const hostAckMs = hostAckSeenAt - hostStartedAt
    const latencyMs = guestSeenAt - hostStartedAt

    await attachRealtimeMetric(testInfo, 'realtime-config-tempo-summary', { hostAckMs, latencyMs, hostConfigRequests })
    await attachLatencyMetric(testInfo, 'realtime-config-tempo', latencyMs)
    await guest.page.screenshot({ path: 'test-results/realtime-config-tempo-under-budget-guest.png', fullPage: true })

    expect(latencyMs).toBeLessThan(REALTIME_UI_CI_BUDGET_MS)
    await expect(guest.page.getByRole('button', { name: /Tempo/i })).toHaveClass(/active/)
  } finally {
    await host.context.close()
    await guest.context.close()
  }
})

test('latence realtime relance dans le budget CI avec preuve visuelle', async ({ browser, request }, testInfo) => {
  test.setTimeout(45_000)

  const { host, guest } = await createCompletedRoom(browser, request)

  try {
    await expect(host.page.getByRole('button', { name: /^Rejouer ce duel$/i })).toBeVisible()
    await expect(guest.page.getByRole('button', { name: /^Rejouer ce duel$/i })).toBeVisible()

    const hostSeenAtPromise = observeTextEpochMs(host.page, 'Relance demand')
    const guestStartedAt = await clickButtonInPageAndReturnEpochMs(guest.page, 'Rejouer ce duel')
    const hostSeenAt = await hostSeenAtPromise
    const latencyMs = hostSeenAt - guestStartedAt

    await attachRealtimeMetric(testInfo, 'realtime-rematch-summary', { latencyMs })
    await attachLatencyMetric(testInfo, 'realtime-rematch-request', latencyMs)
    await host.page.screenshot({ path: 'test-results/realtime-rematch-under-budget-host.png', fullPage: true })

    expect(latencyMs).toBeLessThan(REALTIME_UI_CI_BUDGET_MS)
    await expect(host.page.getByText(/Relance demand/i)).toBeVisible()
    await expect(guest.page.getByRole('button', { name: /Relance demandee|Relance demand/i })).toBeVisible()
  } finally {
    await host.context.close()
    await guest.context.close()
  }
})

test("ne fait pas entrer automatiquement l'invite dans un salon recu", async ({ browser, request }) => {
  test.setTimeout(45_000)

  const reset = await request.post(`${API_URL}/api/e2e/reset-multiplayer`)
  expect(reset.ok()).toBeTruthy()

  const host = await e2ePage(browser, 'host')
  const guest = await e2ePage(browser, 'guest')

  try {
    await host.page.goto(`${APP_URL}/jeu/multijoueur`)
    await guest.page.goto(`${APP_URL}/jeu/multijoueur`)

    await expect(multiplayerLobby(guest.page)).toBeVisible()
    await expect(createRoomButton(guest.page)).toBeVisible()
    await host.page.getByRole('button', { name: /Bob Guest/i }).click()
    await expect(host.page).toHaveURL(/match=/)

    await guest.page.waitForTimeout(1200)
    await expect(guest.page).not.toHaveURL(/match=/)
    await expect(multiplayerLobby(guest.page)).toBeVisible()
    await expect(createRoomButton(guest.page)).toBeVisible()
    await expect(guest.page.locator('.multiplayer-challenge-list .multiplayer-invitation-open')).toHaveCount(1)

    await guest.page.screenshot({ path: 'test-results/invite-received-stays-lobby.png', fullPage: true })
  } finally {
    await host.context.close()
    await guest.context.close()
  }
})

test('garde Mixte selectionne apres un clic rapide Division puis Mixte', async ({ browser, request }) => {
  test.setTimeout(45_000)

  const { host, guest } = await createAcceptedRoom(browser, request)

  try {
    await host.page.getByRole('button', { name: /Sprint/i }).click()
    await host.page.getByRole('button', { name: /butant/i }).click()

    const division = host.page.getByRole('button', { name: /Division/i })
    const mixte = host.page.getByRole('button', { name: /Mixte/i })

    await division.click({ force: true })
    await mixte.click({ force: true })

    await expectActiveOperation(host.page, /Mixte/i)
    await expect(division).not.toHaveClass(/active/)

    await host.page.waitForTimeout(1000)
    await expect(host.page.getByText(/La configuration du salon a change/i)).toHaveCount(0)
    await expectActiveOperation(host.page, /Mixte/i)
    await expect(host.page.getByRole('button', { name: /Division/i })).not.toHaveClass(/active/)
    await expectActiveOperation(guest.page, /Mixte/i)
    await expect(guest.page.getByRole('button', { name: /Division/i })).not.toHaveClass(/active/)

    await host.page.screenshot({ path: 'test-results/fast-division-mixte-host.png', fullPage: true })
    await guest.page.screenshot({ path: 'test-results/fast-division-mixte-guest.png', fullPage: true })
  } finally {
    await host.context.close()
    await guest.context.close()
  }
})

test('ne revient pas visuellement a Sprint apres un clic rapide Sprint puis Tempo', async ({ browser, request }) => {
  test.setTimeout(45_000)

  const { host, guest } = await createAcceptedRoom(browser, request)

  try {
    const sprint = host.page.getByRole('button', { name: /Sprint/i })
    const tempo = host.page.getByRole('button', { name: /Tempo/i })

    await sprint.click({ force: true })
    await expect(guest.page.getByRole('button', { name: /Sprint/i })).toHaveClass(/active/)

    await tempo.click({ force: true })

    await expect(tempo).toHaveClass(/active/)
    await expect(sprint).not.toHaveClass(/active/)

    const observedHostModes = await observeActiveButton(host.page, ['Sprint', 'Tempo'])
    expect(observedHostModes).not.toContain('Sprint')
    expect(observedHostModes).toContain('Tempo')

    await expect(guest.page.getByRole('button', { name: /Tempo/i })).toHaveClass(/active/)
    await expect(guest.page.getByRole('button', { name: /Sprint/i })).not.toHaveClass(/active/)

    await host.page.screenshot({ path: 'test-results/fast-sprint-tempo-host.png', fullPage: true })
    await guest.page.screenshot({ path: 'test-results/fast-sprint-tempo-guest.png', fullPage: true })
  } finally {
    await host.context.close()
    await guest.context.close()
  }
})

test('ne produit pas de commande invalide ni double transition sur clics rapides de configuration et lancement', async ({ browser, request }) => {
  test.setTimeout(45_000)

  const { host, guest } = await createAcceptedRoom(browser, request)
  const configError = /Commande de configuration de defi invalide|Configuration impossible|Synchronisation du salon impossible|authentification|auth requise/i

  try {
    await host.page.getByRole('button', { name: /Tempo/i }).click()
    await host.page.getByLabel(/Questions/i).fill('')
    await host.page.getByLabel(/Questions/i).fill('1')
    await expect(host.page.getByLabel(/Questions/i)).toHaveValue('10')
    await host.page.getByLabel(/Secondes par question|Temps par question/i).fill('1')
    await expect(host.page.getByLabel(/Secondes par question|Temps par question/i)).toHaveValue('5')
    await host.page.getByLabel(/Secondes par question|Temps par question/i).fill('31')
    await expect(host.page.getByLabel(/Secondes par question|Temps par question/i)).toHaveValue('30')

    await host.page.evaluate(() => {
      const labels = ['Sprint', 'Tempo', 'Division', 'Mixte', 'Addition', 'butant']

      for (const label of labels) {
        const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.includes(label))
        button?.click()
      }
    })

    await expect(host.page.getByRole('button', { name: /butant/i })).toHaveClass(/active/)
    await expect(host.page.getByRole('button', { name: /Addition/i })).toHaveClass(/active/)
    await expect(host.page.getByRole('button', { name: /Tempo/i })).toHaveClass(/active/)
    await expect(guest.page.getByRole('button', { name: /Tempo/i })).toHaveClass(/active/)

    await host.page.evaluate(() => {
      const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.includes('Proposer le defi'))
      button?.click()
      button?.click()
    })
    await expect(guest.page.getByRole('button', { name: /Accepter le defi/i })).toBeVisible()

    await guest.page.evaluate(() => {
      const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.includes('Accepter le defi'))
      button?.click()
      button?.click()
    })
    await expect(host.page.locator('.question-line')).toBeVisible()
    await expect(guest.page.locator('.question-line')).toBeVisible()

    await host.page.waitForTimeout(500)
    await expect(host.page.getByText(configError)).toHaveCount(0)
    await expect(guest.page.getByText(configError)).toHaveCount(0)
  } finally {
    await host.context.close()
    await guest.context.close()
  }
})

test('applique un changement de configuration via snapshot realtime sans refresh complet', async ({ browser, request }) => {
  test.setTimeout(45_000)

  const { host, guest } = await createAcceptedRoom(browser, request)

  try {
    // Room creation finishes asynchronously after the acceptance UI becomes
    // visible. Let that one-off bootstrap settle before measuring the config
    // snapshot, which must not itself trigger a REST refresh.
    await guest.page.waitForTimeout(500)

    let overviewRequests = 0
    guest.page.on('request', (pageRequest) => {
      if (pageRequest.url().includes('/api/matches/room-overview')) {
        overviewRequests += 1
      }
    })

    const startedAt = Date.now()
    await host.page.getByRole('button', { name: /Tempo/i }).click()
    await expect(guest.page.getByRole('button', { name: /Tempo/i })).toHaveClass(/active/, { timeout: 2000 })
    const propagationMs = Date.now() - startedAt

    await guest.page.waitForTimeout(500)
    expect(propagationMs).toBeLessThan(2000)
    expect(overviewRequests).toBe(0)
  } finally {
    await host.context.close()
    await guest.context.close()
  }
})

test('tempo garde la meme question jusqu a la borne absolue de 10 secondes', async ({ browser, request }) => {
  test.setTimeout(45_000)

  const { host, guest } = await createAcceptedRoom(browser, request)

  try {
    await host.page.getByRole('button', { name: /Tempo/i }).click()
    await host.page.getByRole('button', { name: /Addition/i }).click()
    await host.page.getByRole('button', { name: /butant/i }).click()
    await host.page.getByLabel(/Questions/i).fill('10')
    await proposeChallenge(host.page)

    await guest.page.getByRole('button', { name: /Accepter le defi/i }).click()
    await expect(host.page.locator('.question-line')).toBeVisible()
    await expect(guest.page.locator('.question-line')).toBeVisible()

    const hostPrompt = await host.page.locator('.question-line').innerText()
    const guestPrompt = await guest.page.locator('.question-line').innerText()
    expect(guestPrompt).toBe(hostPrompt)

    await answerOneQuestion(host.page)
    await expect(host.page.getByRole('button', { name: /En attente/i })).toBeDisabled()
    await host.page.waitForTimeout(2000)
    await expect(host.page.locator('.question-line')).toHaveText(hostPrompt)
    await expect(guest.page.locator('.question-line')).toHaveText(hostPrompt)

    await guest.page.waitForTimeout(9000)
    await expect(host.page.locator('.question-line')).not.toHaveText(hostPrompt)
    await expect(guest.page.locator('.question-line')).not.toHaveText(hostPrompt)
  } finally {
    await host.context.close()
    await guest.context.close()
  }
})

test('tempo garde le focus du champ de reponse apres expiration de question', async ({ browser, request }) => {
  test.setTimeout(45_000)

  const { host, guest } = await createAcceptedRoom(browser, request)

  try {
    await host.page.getByRole('button', { name: /Tempo/i }).click()
    await host.page.getByRole('button', { name: /Addition/i }).click()
    await host.page.getByRole('button', { name: /butant/i }).click()
    await host.page.getByLabel(/Questions/i).fill('10')
    await proposeChallenge(host.page)

    await guest.page.getByRole('button', { name: /Accepter le defi/i }).click()
    await expect(host.page.locator('.question-line')).toBeVisible()

    const firstPrompt = await host.page.locator('.question-line').innerText()
    const answerInput = host.page.getByLabel(/Votre reponse|Votre réponse/i)

    await answerInput.focus()
    await expect.poll(() => host.page.evaluate(() => document.activeElement?.tagName)).toBe('INPUT')
    await host.page.waitForTimeout(11_000)
    await expect(host.page.locator('.question-line')).not.toHaveText(firstPrompt)
    await expect.poll(() => host.page.evaluate(() => document.activeElement?.tagName)).toBe('INPUT')

    await host.page.screenshot({ path: 'test-results/tempo-focus-after-expiration.png', fullPage: true })
  } finally {
    await host.context.close()
    await guest.context.close()
  }
})

test('tempo avance des que les deux joueurs ont repondu a la meme question', async ({ browser, request }, testInfo) => {
  test.setTimeout(45_000)

  const { host, guest } = await createAcceptedRoom(browser, request)

  try {
    await host.page.getByRole('button', { name: /Tempo/i }).click()
    await host.page.getByRole('button', { name: /Addition/i }).click()
    await host.page.getByRole('button', { name: /butant/i }).click()
    await host.page.getByLabel(/Questions/i).fill('10')
    await proposeChallenge(host.page)

    await guest.page.getByRole('button', { name: /Accepter le defi/i }).click()
    await expect(host.page.locator('.question-line')).toBeVisible()
    await expect(guest.page.locator('.question-line')).toBeVisible()

    const firstPrompt = await host.page.locator('.question-line').innerText()
    await expect(guest.page.locator('.question-line')).toHaveText(firstPrompt)

    const hostScoreLatencyMs = await answerOneQuestionAndObserveMetricLatencyMs(host.page, 'Score', '^[1-9][0-9]*$')

    console.info(`[performance] multiplayer-tempo-answer-ui=${hostScoreLatencyMs.toFixed(2)}ms`)
    await attachRealtimeMetric(testInfo, 'realtime-tempo-first-answer-summary', { hostScoreLatencyMs })
    await attachLatencyMetric(testInfo, 'realtime-tempo-host-score-immediate', hostScoreLatencyMs, ANSWER_UI_CI_BUDGET_MS)
    expect(hostScoreLatencyMs).toBeLessThan(ANSWER_UI_CI_BUDGET_MS)
    await expect(host.page.getByRole('button', { name: /En attente/i })).toBeDisabled()
    await host.page.waitForTimeout(1000)
    await expect(host.page.locator('.question-line')).toHaveText(firstPrompt)
    await expect(guest.page.locator('.question-line')).toHaveText(firstPrompt)
    await host.page.screenshot({ path: 'test-results/realtime-tempo-score-before-opponent-host.png', fullPage: true })

    const hostReadyPromise = waitForEnabledSubmit(host.page)
    const guestStartedAt = await answerOneQuestionAndReturnStartedAtMs(guest.page)
    const hostReadyObservedAt = await hostReadyPromise
    const latencyMs = hostReadyObservedAt - guestStartedAt

    await attachRealtimeMetric(testInfo, 'realtime-tempo-next-question-summary', { latencyMs })
    await attachLatencyMetric(testInfo, 'realtime-tempo-next-question', latencyMs)
    await host.page.screenshot({ path: 'test-results/realtime-tempo-next-question-under-budget-host.png', fullPage: true })

    expect(latencyMs).toBeLessThan(REALTIME_UI_CI_BUDGET_MS)
    await expect(host.page.locator('.question-line')).not.toHaveText(firstPrompt, { timeout: 2500 })
    await expect(guest.page.locator('.question-line')).not.toHaveText(firstPrompt, { timeout: 2500 })
    await expect(guest.page.locator('.question-line')).toHaveText(await host.page.locator('.question-line').innerText())
    await expect.poll(() => readChallengeTimer(host.page)).toBeLessThanOrEqual(10)
    await expect.poll(() => readChallengeTimer(guest.page)).toBeLessThanOrEqual(10)
  } finally {
    await host.context.close()
    await guest.context.close()
  }
})

test("tempo finalise les deux joueurs sur resultats quand la derniere reponse invite expire", async ({ browser, request }) => {
  test.setTimeout(75_000)

  const { host, guest } = await createAcceptedRoom(browser, request)

  try {
    await startTempoMatch(host.page, guest.page)

    for (let index = 0; index < 9; index += 1) {
      const prompt = await host.page.locator('.question-line').innerText()
      await expect(guest.page.locator('.question-line')).toHaveText(prompt)
      await answerOneQuestion(host.page)
      await answerOneQuestion(guest.page)
      await expect(host.page.locator('.question-line')).not.toHaveText(prompt, { timeout: 2500 })
      await expect(guest.page.locator('.question-line')).toHaveText(await host.page.locator('.question-line').innerText())
    }

    const finalPrompt = await host.page.locator('.question-line').innerText()
    await expect(guest.page.locator('.question-line')).toHaveText(finalPrompt)
    await guest.page.getByLabel(/Votre reponse|Votre r.*ponse/i).fill('bb')
    await answerOneQuestion(host.page)

    for (const page of [host.page, guest.page]) {
      await expect(page.locator('.multiplayer-result-panel')).toBeVisible({ timeout: 15_000 })
      await expect(multiplayerLobby(page)).toHaveCount(0)
      await expect(page.locator('.question-line')).toHaveCount(0)
      await expect(page.getByRole('button', { name: /^Rejouer ce duel$/i })).toBeVisible()
    }

    await host.page.screenshot({ path: 'test-results/tempo-final-expired-answer-host-results.png', fullPage: true })
    await guest.page.screenshot({ path: 'test-results/tempo-final-expired-answer-guest-results.png', fullPage: true })
  } finally {
    await host.context.close()
    await guest.context.close()
  }
})

test("tempo garde l'invite dans le salon quand il termine avant l'hote", async ({ browser, request }) => {
  test.setTimeout(75_000)

  const { host, guest } = await createAcceptedRoom(browser, request)

  try {
    await startTempoMatch(host.page, guest.page)

    for (let index = 0; index < 9; index += 1) {
      const prompt = await host.page.locator('.question-line').innerText()
      await expect(guest.page.locator('.question-line')).toHaveText(prompt)
      await answerOneQuestion(host.page)
      await answerOneQuestion(guest.page)
      await expect(host.page.locator('.question-line')).not.toHaveText(prompt, { timeout: 2500 })
      await expect(guest.page.locator('.question-line')).toHaveText(await host.page.locator('.question-line').innerText())
    }

    const finalPrompt = await host.page.locator('.question-line').innerText()
    await expect(guest.page.locator('.question-line')).toHaveText(finalPrompt)
    await answerOneQuestion(guest.page)

    await expect(guest.page.getByTestId('multiplayer-waiting-for-opponent')).toBeVisible({ timeout: 5000 })
    await expect(multiplayerLobby(guest.page)).toHaveCount(0)
    await expect(guest.page.locator('.multiplayer-room-grid')).toBeVisible()

    await guest.page.waitForTimeout(1800)
    await expect(guest.page.getByTestId('multiplayer-waiting-for-opponent')).toBeVisible()
    await expect(multiplayerLobby(guest.page)).toHaveCount(0)
    await expect(host.page.locator('.question-line')).toHaveText(finalPrompt)

    await host.page.screenshot({ path: 'test-results/tempo-guest-finished-first-host-still-playing.png', fullPage: true })
    await guest.page.screenshot({ path: 'test-results/tempo-guest-finished-first-guest-waiting.png', fullPage: true })

    await answerOneQuestion(host.page)

    for (const page of [host.page, guest.page]) {
      await expect(page.locator('.multiplayer-result-panel')).toBeVisible({ timeout: 15_000 })
      await expect(multiplayerLobby(page)).toHaveCount(0)
      await expect(page.getByRole('button', { name: /^Rejouer ce duel$/i })).toBeVisible()
    }
  } finally {
    await host.context.close()
    await guest.context.close()
  }
})

test('quitter les resultats ferme le salon pour les deux joueurs', async ({ browser, request }) => {
  test.setTimeout(75_000)

  const { host, guest } = await createCompletedRoom(browser, request)

  try {
    await guest.page.getByRole('button', { name: /^Rejouer ce duel$/i }).click()
    await expect(guest.page.getByRole('button', { name: /Relance demandee|Relance demandée/i })).toBeVisible()

    await host.page.getByRole('button', { name: /^Quitter le r.sultat$/i }).click()
    await expectClosedRoomLobby(host.page)
    await expectClosedRoomLobby(guest.page)

    await host.page.waitForTimeout(1200)
    await expectClosedRoomLobby(host.page)
    await expectClosedRoomLobby(guest.page)

    await host.page.screenshot({ path: 'test-results/results-quit-closes-room-host.png', fullPage: true })
    await guest.page.screenshot({ path: 'test-results/results-quit-closes-room-guest.png', fullPage: true })
  } finally {
    await host.context.close()
    await guest.context.close()
  }
})

test("stop cote hote termine en abandon, garde la session resultat et permet la relance", async ({ browser, request }) => {
  test.setTimeout(45_000)

  const { host, guest } = await createAcceptedRoom(browser, request)

  try {
    await startSprintMatch(host.page, guest.page)
    await expect(roomStopButton(host.page)).toBeVisible()
    await answerOneQuestion(host.page)
    await answerOneQuestion(guest.page)
    await host.page.screenshot({ path: 'test-results/stop-button-inline-host.png', fullPage: true })

    await roomStopButton(host.page).click()

    await expectForfeitResult(host.page, guest.page, { screenshotName: 'stop-host-result', expectAnsweredStats: true })
  } finally {
    await host.context.close()
    await guest.context.close()
  }
})

test("stop cote invite termine en abandon, garde la session resultat et permet la relance", async ({ browser, request }) => {
  test.setTimeout(45_000)

  const { host, guest } = await createAcceptedRoom(browser, request)

  try {
    await startSprintMatch(host.page, guest.page)
    await expect(roomStopButton(guest.page)).toBeVisible()
    await answerOneQuestion(host.page)
    await answerOneQuestion(guest.page)
    await guest.page.screenshot({ path: 'test-results/stop-button-inline-guest.png', fullPage: true })

    await roomStopButton(guest.page).click()

    await expectForfeitResult(guest.page, host.page, { screenshotName: 'stop-guest-result', expectAnsweredStats: true })
  } finally {
    await host.context.close()
    await guest.context.close()
  }
})

test('garde un chrono sprint synchronise apres rafraichissement du joueur invite', async ({ browser, request }) => {
  test.setTimeout(45_000)

  const { host, guest } = await createAcceptedRoom(browser, request)

  try {
    await host.page.getByRole('button', { name: /Sprint/i }).click()
    await host.page.getByRole('button', { name: /Addition/i }).click()
    await host.page.getByRole('button', { name: /butant/i }).click()
    await proposeChallenge(host.page)
    await expect(guest.page.getByRole('button', { name: /Accepter le defi/i })).toBeVisible()
    await guest.page.getByRole('button', { name: /Accepter le defi/i }).click()

    await expect(host.page.locator('.question-line')).toBeVisible()
    await expect(guest.page.locator('.question-line')).toBeVisible()

    await host.page.waitForTimeout(3200)
    const overviewResponse = guest.page.waitForResponse((response) =>
      response.request().method() === 'GET' && new URL(response.url()).pathname === '/api/matches/room-overview',
    )
    await guest.page.reload()
    expect((await overviewResponse).headers()['cache-control']).toContain('no-store')
    await expect(guest.page.locator('.question-line')).toBeVisible()

    const [hostRemaining, guestRemaining] = await Promise.all([
      readSprintTimer(host.page),
      readSprintTimer(guest.page),
    ])

    expect(guestRemaining).toBeLessThan(60)
    expect(Math.abs(hostRemaining - guestRemaining)).toBeLessThanOrEqual(2)
  } finally {
    await host.context.close()
    await guest.context.close()
  }
})

test("ne couple pas le chrono sprint au nombre de reponses", async ({ browser, request }) => {
  test.setTimeout(45_000)

  const { host, guest } = await createAcceptedRoom(browser, request)

  try {
    await host.page.getByRole('button', { name: /Sprint/i }).click()
    await host.page.getByRole('button', { name: /Addition/i }).click()
    await host.page.getByRole('button', { name: /butant/i }).click()
    await proposeChallenge(host.page)
    await expect(guest.page.getByRole('button', { name: /Accepter le defi/i })).toBeVisible()
    await guest.page.getByRole('button', { name: /Accepter le defi/i }).click()

    await expect(guest.page.locator('.question-line')).toBeVisible()
    const beforeAnswers = await readSprintTimer(guest.page)

    await answerOneQuestion(guest.page)
    await answerOneQuestion(guest.page)
    await answerOneQuestion(guest.page)

    const afterAnswers = await readSprintTimer(guest.page)

    expect(beforeAnswers - afterAnswers).toBeLessThanOrEqual(4)
  } finally {
    await host.context.close()
    await guest.context.close()
  }
})
