import { expect, type Browser, type Page, type TestInfo, test } from '@playwright/test'

const APP_URL = process.env.E2E_APP_URL ?? 'http://127.0.0.1:5174'
const API_URL = process.env.E2E_API_URL ?? 'http://127.0.0.1:4100'

async function authenticate(page: Page, user: 'host' | 'guest' = 'host') {
  await page.addInitScript((value) => {
    try {
      window.localStorage.setItem('mayele.e2e.user', value)
    } catch {
      // Some transient browser documents do not expose localStorage.
    }
  }, user)
}

async function authenticatedPage(browser: Browser, user: 'host' | 'guest', viewport: { width: number; height: number }) {
  const context = await browser.newContext({ viewport })
  const page = await context.newPage()
  await authenticate(page, user)
  return { context, page }
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
  await testInfo.attach(`${testInfo.project.name}-${name}`, { body, contentType: 'image/png' })
}

async function assertShellNavigation(page: Page) {
  const viewport = page.viewportSize()
  const isMobileShell = (viewport?.width ?? 1024) < 1024

  if (isMobileShell) {
    await expect(page.locator('.mobile-bottom-nav')).toBeVisible()
    await expect(page.locator('.desktop-sidebar')).toBeHidden()
    await page.getByRole('button', { name: /Ouvrir le menu/i }).click()
    await expect(page.locator('#mobile-menu-panel')).toBeVisible()
    await page.getByRole('link', { name: /Statistiques/i }).click()
    await expect(page).toHaveURL(/\/dashboard\?view=stats/)
    await expect(page.locator('#mobile-menu-panel')).toHaveCount(0)
  } else {
    await expect(page.locator('.desktop-sidebar')).toBeVisible()
    await expect(page.locator('.mobile-bottom-nav')).toBeHidden()
  }
}

test.beforeEach(async ({ page }) => {
  await authenticate(page, 'host')
})

test('navigation shell et dashboard sans overflow', async ({ page }, testInfo) => {
  await page.goto(`${APP_URL}/dashboard`)
  await expect(page.getByRole('heading', { name: /Alice Host/i })).toBeVisible({ timeout: 15_000 })
  await assertShellNavigation(page)

  const dashboardViews = [
    { path: '/dashboard', name: 'dashboard-overview', panel: '.dashboard-overview-section.active' },
    { path: '/dashboard?view=stats', name: 'dashboard-stats', panel: '.dashboard-level-section.active' },
    { path: '/dashboard?view=missions', name: 'dashboard-missions', panel: '.dashboard-plan-section.active' },
    { path: '/dashboard?view=history', name: 'dashboard-history', panel: '.dashboard-history-section.active' },
  ]

  for (const view of dashboardViews) {
    await page.goto(`${APP_URL}${view.path}`)
    await expect(page.locator(view.panel)).toBeVisible()
    await expect(page.locator('.dashboard-section-nav')).toBeVisible()

    if ((page.viewportSize()?.width ?? 1024) < 768) {
      const mobileDashboardLayout = await page.evaluate(() => {
        const hero = document.querySelector('.dashboard-hero-v2')
        const badges = document.querySelector('.dashboard-profile-badges-section')
        const nav = document.querySelector('.dashboard-section-nav')
        const panel = document.querySelector('.dashboard-view-panel.active')
        const missionsSummary = document.querySelector('.dashboard-badge-mobile-summary')
        const heroRect = hero?.getBoundingClientRect()
        const badgesRect = badges?.getBoundingClientRect()
        const navRect = nav?.getBoundingClientRect()
        const panelRect = panel?.getBoundingClientRect()

        return {
          navPosition: nav ? window.getComputedStyle(nav).position : '',
          navTop: navRect?.top ?? 0,
          heroTop: heroRect?.top ?? 0,
          badgesTop: badgesRect?.top ?? 0,
          panelTop: panelRect?.top ?? 0,
          summaryDisplay: missionsSummary ? window.getComputedStyle(missionsSummary).display : '',
        }
      })

      expect(mobileDashboardLayout.navPosition).toBe('static')

      if (view.name === 'dashboard-overview') {
        expect(mobileDashboardLayout.navTop).toBeLessThan(mobileDashboardLayout.heroTop)
        expect(mobileDashboardLayout.heroTop).toBeLessThan(mobileDashboardLayout.badgesTop)
        expect(mobileDashboardLayout.badgesTop).toBeLessThan(mobileDashboardLayout.panelTop)
      }

      if (view.name === 'dashboard-missions') {
        expect(mobileDashboardLayout.summaryDisplay).toBe('flex')

        const firstBadgePanel = page.locator('.dashboard-badge-detail-stack .badge-family-panel').first()
        await firstBadgePanel.locator('summary').click()
        await expect(firstBadgePanel).toHaveAttribute('open', '')

        const expandedBadgeLayout = await firstBadgePanel.evaluate((panel) => {
          const levelGrid = panel.querySelector('.badge-level-grid')
          const objectiveCard = panel.querySelector('.badge-objective-card')
          const objectiveList = panel.querySelector('.objective-check-list')
          const panelRect = panel.getBoundingClientRect()
          const cardRect = objectiveCard?.getBoundingClientRect()

          return {
            panelOverflowY: window.getComputedStyle(panel).overflowY,
            levelGridOverflowX: levelGrid ? window.getComputedStyle(levelGrid).overflowX : '',
            objectiveListDisplay: objectiveList ? window.getComputedStyle(objectiveList).display : '',
            panelRight: panelRect.right,
            cardRight: cardRect?.right ?? 0,
            innerWidth: window.innerWidth,
          }
        })

        expect(expandedBadgeLayout.panelOverflowY).toBe('visible')
        expect(expandedBadgeLayout.levelGridOverflowX).toBe('visible')
        expect(expandedBadgeLayout.objectiveListDisplay).toBe('none')
        expect(expandedBadgeLayout.panelRight).toBeLessThanOrEqual(expandedBadgeLayout.innerWidth + 1)
        expect(expandedBadgeLayout.cardRight).toBeLessThanOrEqual(expandedBadgeLayout.innerWidth + 1)

        await firstBadgePanel.locator('.badge-objective-card').first().click()
        const badgeSheet = page.locator('.dashboard-badge-sheet')
        await expect(badgeSheet).toBeVisible()

        const badgeSheetLayout = await badgeSheet.evaluate((sheet) => {
          const sheetRect = sheet.getBoundingClientRect()
          const objectiveList = sheet.querySelector('.dashboard-badge-sheet-objectives')

          return {
            sheetRight: sheetRect.right,
            sheetBottom: sheetRect.bottom,
            innerWidth: window.innerWidth,
            innerHeight: window.innerHeight,
            objectiveListDisplay: objectiveList ? window.getComputedStyle(objectiveList).display : '',
          }
        })

        expect(badgeSheetLayout.sheetRight).toBeLessThanOrEqual(badgeSheetLayout.innerWidth + 1)
        expect(badgeSheetLayout.sheetBottom).toBeLessThanOrEqual(badgeSheetLayout.innerHeight + 1)
        expect(badgeSheetLayout.objectiveListDisplay).toBe('grid')
        await page.getByRole('button', { name: /Fermer le detail du badge/i }).click()
        await expect(badgeSheet).toHaveCount(0)
      }
    }

    await expectNoHorizontalOverflow(page, view.name)
    await attachScreenshot(page, testInfo, view.name)
  }
})

test('solo setup puis arene restent utilisables', async ({ page }, testInfo) => {
  await page.goto(`${APP_URL}/jeu/solo`)
  await expect(page.getByRole('button', { name: /Commencer le sprint/i })).toBeVisible()
  if ((page.viewportSize()?.width ?? 1024) < 768) {
    const soloSetupLayout = await page.evaluate(() => {
      const board = document.querySelector('.challenge-config-board')
      const rows = Array.from(document.querySelectorAll('.challenge-config-board .challenge-config-row'))
      const operationGrid = document.querySelector('.challenge-config-board .challenge-operation-grid')

      return {
        boardVisible: Boolean(board?.checkVisibility()),
        rowCount: rows.length,
        firstRowColumns: rows[0] ? window.getComputedStyle(rows[0]).gridTemplateColumns.split(' ').length : 0,
        operationDisplay: operationGrid ? window.getComputedStyle(operationGrid).display : '',
        operationOverflowX: operationGrid ? window.getComputedStyle(operationGrid).overflowX : '',
      }
    })

    expect(soloSetupLayout.boardVisible).toBe(true)
    expect(soloSetupLayout.rowCount).toBeGreaterThanOrEqual(3)
    expect(soloSetupLayout.firstRowColumns).toBe(2)
    expect(soloSetupLayout.operationDisplay).toBe('flex')
    expect(soloSetupLayout.operationOverflowX).toBe('auto')
  }
  await expectNoHorizontalOverflow(page, 'solo setup')
  await attachScreenshot(page, testInfo, 'solo-setup')

  await page.getByRole('button', { name: /Commencer le sprint/i }).click()
  await expect(page.locator('.question-line')).toBeVisible()
  await expect(page.getByRole('textbox', { name: /Votre reponse/i })).toBeFocused()
  await expectNoHorizontalOverflow(page, 'solo arena')
  await attachScreenshot(page, testInfo, 'solo-arena')

  const prompt = await page.locator('.question-line').innerText()
  await page.getByRole('textbox', { name: /Votre reponse/i }).fill(String(solvePrompt(prompt)))
  await page.getByRole('button', { name: /Valider/i }).click()
  await expect(page.getByRole('textbox', { name: /Votre reponse/i })).toBeFocused()
})

test('amis et profil restent lisibles sans debordement', async ({ page, request }, testInfo) => {
  const reset = await request.post(`${API_URL}/api/e2e/reset-multiplayer`)
  expect(reset.ok()).toBeTruthy()

  await page.goto(`${APP_URL}/amis`)
  await expect(page.getByRole('button', { name: /Mes amis/i })).toBeVisible()
  if ((page.viewportSize()?.width ?? 1024) < 768) {
    const friendsLayout = await page.evaluate(() => {
      const scroller = document.querySelector('.profile-card-scroller')
      const card = document.querySelector('.profile-card')
      const actions = card?.querySelector('.profile-card-actions')
      const cardRect = card?.getBoundingClientRect()

      return {
        scrollerDisplay: scroller ? window.getComputedStyle(scroller).display : '',
        scrollerOverflowX: scroller ? window.getComputedStyle(scroller).overflowX : '',
        cardWidth: cardRect?.width ?? 0,
        cardRight: cardRect?.right ?? 0,
        actionsColumns: actions ? window.getComputedStyle(actions).gridTemplateColumns.split(' ').length : 0,
        innerWidth: window.innerWidth,
      }
    })

    if (friendsLayout.scrollerDisplay) {
      expect(friendsLayout.scrollerDisplay).toBe('grid')
      expect(friendsLayout.scrollerOverflowX).toBe('visible')
      expect(friendsLayout.cardWidth).toBeGreaterThan(300)
      expect(friendsLayout.cardRight).toBeLessThanOrEqual(friendsLayout.innerWidth + 1)
      expect(friendsLayout.actionsColumns).toBeGreaterThanOrEqual(1)
    } else {
      await expect(page.locator('.friends-empty-panel')).toBeVisible()
    }

    await page.getByRole('button', { name: /Rechercher/i }).click()
    await expect(page.getByLabel(/Nom d'utilisateur/i)).toBeVisible()
    const searchLayout = await page.evaluate(() => {
      const searchCard = document.querySelector('.search-prompt-card')

      return {
        searchColumns: searchCard ? window.getComputedStyle(searchCard).gridTemplateColumns.split(' ').length : 0,
        searchRight: searchCard?.getBoundingClientRect().right ?? 0,
        innerWidth: window.innerWidth,
      }
    })

    expect(searchLayout.searchColumns).toBe(2)
    expect(searchLayout.searchRight).toBeLessThanOrEqual(searchLayout.innerWidth + 1)

    await page.getByLabel(/Nom d'utilisateur/i).fill('bob')
    await page.locator('.card-search-form').getByRole('button', { name: /^Rechercher$/i }).click()
    await expect(page.getByText(/Bob Guest/i)).toBeVisible()

    const resultCardLayout = await page.locator('.profile-card').filter({ hasText: /Bob Guest/i }).evaluate((card) => {
      const cardRect = card.getBoundingClientRect()
      const actions = card.querySelector('.profile-card-actions')

      return {
        cardRight: cardRect.right,
        cardWidth: cardRect.width,
        actionsColumns: actions ? window.getComputedStyle(actions).gridTemplateColumns.split(' ').length : 0,
        innerWidth: window.innerWidth,
      }
    })

    expect(resultCardLayout.cardWidth).toBeGreaterThan(300)
    expect(resultCardLayout.cardRight).toBeLessThanOrEqual(resultCardLayout.innerWidth + 1)
    expect(resultCardLayout.actionsColumns).toBe(2)

    await expectNoHorizontalOverflow(page, 'friends')
    await attachScreenshot(page, testInfo, 'friends')

    await page.locator('.profile-card').filter({ hasText: /Bob Guest/i }).getByRole('button', { name: /Voir le profil/i }).click()
    await expect(page).toHaveURL(/\/amis\//)
    await expect(page.getByRole('heading', { name: /Bob Guest/i })).toBeVisible()

    const friendProfileLayout = await page.evaluate(() => {
      const hero = document.querySelector('.friend-profile-hero')
      const summary = document.querySelector('.friend-profile-summary')
      const badgeGrid = document.querySelector('.friend-badge-grid')
      const statGrid = document.querySelector('.friend-stat-grid')
      const levelGrid = document.querySelector('.friend-level-grid')
      const heroRect = hero?.getBoundingClientRect()

      return {
        heroColumns: hero ? window.getComputedStyle(hero).gridTemplateColumns.split(' ').length : 0,
        heroRight: heroRect?.right ?? 0,
        summaryColumns: summary ? window.getComputedStyle(summary).gridTemplateColumns.split(' ').length : 0,
        badgeDisplay: badgeGrid ? window.getComputedStyle(badgeGrid).display : '',
        badgeOverflowX: badgeGrid ? window.getComputedStyle(badgeGrid).overflowX : '',
        statDisplay: statGrid ? window.getComputedStyle(statGrid).display : '',
        statOverflowX: statGrid ? window.getComputedStyle(statGrid).overflowX : '',
        levelDisplay: levelGrid ? window.getComputedStyle(levelGrid).display : '',
        levelOverflowX: levelGrid ? window.getComputedStyle(levelGrid).overflowX : '',
        innerWidth: window.innerWidth,
      }
    })

    expect(friendProfileLayout.heroColumns).toBe(2)
    expect(friendProfileLayout.heroRight).toBeLessThanOrEqual(friendProfileLayout.innerWidth + 1)
    expect(friendProfileLayout.summaryColumns).toBe(3)
    expect(friendProfileLayout.badgeDisplay).toBe('flex')
    expect(['auto', 'scroll']).toContain(friendProfileLayout.badgeOverflowX)
    expect(friendProfileLayout.statDisplay).toBe('flex')
    expect(['auto', 'scroll']).toContain(friendProfileLayout.statOverflowX)
    expect(friendProfileLayout.levelDisplay).toBe('flex')
    expect(['auto', 'scroll']).toContain(friendProfileLayout.levelOverflowX)

    await expectNoHorizontalOverflow(page, 'friend profile')
    await attachScreenshot(page, testInfo, 'friend-profile')
  } else {
    await expectNoHorizontalOverflow(page, 'friends')
    await attachScreenshot(page, testInfo, 'friends')
  }

  await page.goto(`${APP_URL}/profil/configuration`)
  await expect(page.getByLabel(/Prenom|Pr.*nom/i)).toBeVisible()
  await expect(page.getByRole('button', { name: /Enregistrer mes informations/i })).toBeVisible()
  await expectNoHorizontalOverflow(page, 'profile')
  await attachScreenshot(page, testInfo, 'profile')
})

test('multijoueur lobby room et arene restent utilisables', async ({ page, browser, request }, testInfo) => {
  test.setTimeout(60_000)

  const reset = await request.post(`${API_URL}/api/e2e/reset-multiplayer`)
  expect(reset.ok()).toBeTruthy()

  const viewport = page.viewportSize() ?? { width: 390, height: 844 }
  const guest = await authenticatedPage(browser, 'guest', viewport)

  try {
    await page.goto(`${APP_URL}/jeu/multijoueur`)
    await guest.page.goto(`${APP_URL}/jeu/multijoueur`)
    await expect(page.locator('.multiplayer-lobby-grid')).toBeVisible()
    await expectNoHorizontalOverflow(page, 'multiplayer lobby')
    await attachScreenshot(page, testInfo, 'multiplayer-lobby')

    if ((viewport.width ?? 1024) < 768) {
      await expect(page.getByRole('button', { name: /Bob Guest/i })).toBeVisible()

      const mobileLobbyLayout = await page.evaluate(() => {
        const directList = document.querySelector('.multiplayer-direct-list')
        const titleRow = document.querySelector('.multiplayer-lobby-title-row')
        const createButton = titleRow?.querySelector('button')
        const titleRowRect = titleRow?.getBoundingClientRect()
        const createButtonRect = createButton?.getBoundingClientRect()

        return {
          directListDisplay: directList ? window.getComputedStyle(directList).display : '',
          directListOverflowX: directList ? window.getComputedStyle(directList).overflowX : '',
          titleColumns: titleRow ? window.getComputedStyle(titleRow).gridTemplateColumns.split(' ').length : 0,
          createButtonWidth: createButtonRect?.width ?? 0,
          titleRowWidth: titleRowRect?.width ?? 0,
        }
      })

      expect(mobileLobbyLayout.directListDisplay).toBe('flex')
      expect(mobileLobbyLayout.directListOverflowX).toBe('auto')
      expect(mobileLobbyLayout.titleColumns).toBe(2)
      expect(mobileLobbyLayout.createButtonWidth).toBeLessThan(mobileLobbyLayout.titleRowWidth)
      await page.getByRole('button', { name: /^Créer un salon$/i }).click()
      const draftMobileRoomNav = page.locator('.multiplayer-mobile-room-nav')
      const draftRoomGrid = page.locator('.multiplayer-room-grid')
      const draftControls = page.locator('#multiplayer-room-controls')
      const draftPlayers = page.locator('#multiplayer-room-players')
      await expect(draftMobileRoomNav).toBeVisible()
      await expect(draftMobileRoomNav.locator('.multiplayer-mobile-room-jump button')).toHaveCount(2)
      await expect(draftMobileRoomNav.getByText(/Ami a inviter/i)).toHaveCount(0)
      await expect(draftMobileRoomNav.locator('.multiplayer-mobile-invite-button')).toBeEnabled()
      await expect(draftControls).toBeVisible()
      await expect(draftPlayers).toBeHidden()
      await draftMobileRoomNav.getByRole('button', { name: /Joueurs/i }).click()
      await expect(draftRoomGrid).toHaveAttribute('data-mobile-room-view', 'players')
      await expect(draftPlayers).toBeVisible()
      await expect(draftControls).toBeHidden()
      await draftMobileRoomNav.getByRole('button', { name: /Inviter/i }).click()
      await expect(page.locator('.friend-picker-panel')).toBeVisible()
      await page.getByRole('button', { name: /Fermer la liste d'amis/i }).click()
      await expect(page.locator('.friend-picker-panel')).toHaveCount(0)
      await draftMobileRoomNav.getByRole('button', { name: /Defi/i }).click()
      await expect(draftRoomGrid).toHaveAttribute('data-mobile-room-view', 'primary')
      await expect(draftControls).toBeVisible()
      await expect(draftPlayers).toBeHidden()
      await page.getByRole('button', { name: /Fermer le salon/i }).click()
      await expect(page.locator('.multiplayer-lobby-grid')).toBeVisible()
    }

    await page.getByRole('button', { name: /Bob Guest/i }).click()
    await expect(page).toHaveURL(/match=/)
    await guest.page.goto(page.url())
    await guest.page.getByRole('button', { name: /Entrer dans le salon/i }).click()
    await expect(page.locator('.multiplayer-room-grid')).toBeVisible()
    if ((viewport.width ?? 1024) < 768) {
      const mobileRoomNav = page.locator('.multiplayer-mobile-room-nav')
      const roomGrid = page.locator('.multiplayer-room-grid')
      const controls = page.locator('#multiplayer-room-controls')
      const players = page.locator('#multiplayer-room-players')
      await expect(mobileRoomNav).toBeVisible()
      await expect(mobileRoomNav.locator('.multiplayer-mobile-room-jump button')).toHaveCount(2)
      await expect(mobileRoomNav.getByRole('button', { name: /Defi/i })).toBeVisible()
      await expect(roomGrid).toHaveAttribute('data-mobile-room-view', 'primary')
      await expect(controls).toBeVisible()
      await expect(players).toBeHidden()
      await mobileRoomNav.getByRole('button', { name: /Joueurs/i }).click()
      await expect(roomGrid).toHaveAttribute('data-mobile-room-view', 'players')
      await expect(players).toBeVisible()
      await expect(controls).toBeHidden()
      await mobileRoomNav.getByRole('button', { name: /Defi/i }).click()
      await expect(roomGrid).toHaveAttribute('data-mobile-room-view', 'primary')
    }
    await expectNoHorizontalOverflow(page, 'multiplayer room host')
    await attachScreenshot(page, testInfo, 'multiplayer-room')

    await page.getByRole('button', { name: /Sprint/i }).click()
    await page.getByRole('button', { name: /Addition/i }).click()
    await page.getByRole('button', { name: /butant/i }).click()
    await page.getByRole('button', { name: /Proposer le defi/i }).click()
    await expect(guest.page.getByRole('button', { name: /Accepter le defi/i })).toBeVisible()
    await guest.page.getByRole('button', { name: /Accepter le defi/i }).click()

    await expect(page.locator('.challenge-arena')).toBeVisible()
    await expect(page.getByRole('button', { name: /^Stop$/i }).first()).toBeVisible()
    await expectNoHorizontalOverflow(page, 'multiplayer arena host')
    await attachScreenshot(page, testInfo, 'multiplayer-arena')
  } finally {
    await guest.context.close()
  }
})
