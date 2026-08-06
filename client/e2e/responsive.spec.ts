import { expect, type APIRequestContext, type Browser, type Page, type TestInfo, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { waitForRealtimeReady } from './realtime'

const APP_URL = process.env.E2E_APP_URL ?? 'http://127.0.0.1:5174'
const API_URL = process.env.E2E_API_URL ?? 'http://127.0.0.1:4100'
const CAPTURE_DIR = join(process.cwd(), '..', 'local_data', 'responsive-captures')

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

async function resetMultiplayerFixture(request: APIRequestContext) {
  const reset = await request.post(`${API_URL}/api/e2e/reset-multiplayer`)
  expect(reset.ok()).toBeTruthy()
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
  mkdirSync(CAPTURE_DIR, { recursive: true })
  writeFileSync(join(CAPTURE_DIR, `${testInfo.project.name}-${name}.png`), body)
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
    await expect(page.locator('#mobile-menu-panel').getByRole('link', { name: /^Mon espace$/i })).toHaveAttribute('href', '/dashboard')
    await page.keyboard.press('Escape')
    await expect(page.locator('#mobile-menu-panel')).toHaveCount(0)
    await page.locator('.dashboard-section-nav').getByRole('button', { name: /^Stats$/i }).click()
    await expect(page).toHaveURL(/\/dashboard\?view=stats/)
    await expect(page.locator('#mobile-menu-panel')).toHaveCount(0)
  } else {
    await expect(page.locator('.desktop-sidebar')).toBeVisible()
    await expect(page.locator('.mobile-bottom-nav')).toBeHidden()
    await expect(page.locator('.desktop-sidebar').getByRole('link', { name: /^Mon espace$/i })).toHaveAttribute('href', '/dashboard')
    await expect(page.locator('.desktop-sidebar').getByRole('link', { name: /Statistiques/i })).toHaveCount(0)
  }
}

test.beforeEach(async ({ page, request }) => {
  await resetMultiplayerFixture(request)
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

    const desktopDashboardOrder = await page.evaluate(() => {
      const pageRoot = document.querySelector('.dashboard-page')
      const nav = document.querySelector('.dashboard-section-nav')
      const hero = document.querySelector('.dashboard-player-header')
      const badges = document.querySelector('.dashboard-profile-badges-section')

      return {
        navIndex: pageRoot && nav ? Array.from(pageRoot.children).indexOf(nav) : -1,
        heroIndex: pageRoot && hero ? Array.from(pageRoot.children).indexOf(hero) : -1,
        badgesIndex: pageRoot && badges ? Array.from(pageRoot.children).indexOf(badges) : -1,
      }
    })

    expect(desktopDashboardOrder.navIndex).toBe(0)
    if (view.name === 'dashboard-overview') {
      expect(desktopDashboardOrder.heroIndex).toBeGreaterThan(desktopDashboardOrder.navIndex)
      expect(desktopDashboardOrder.badgesIndex).toBeGreaterThan(desktopDashboardOrder.heroIndex)
    } else {
      expect(desktopDashboardOrder.heroIndex).toBe(-1)
      expect(desktopDashboardOrder.badgesIndex).toBe(-1)
    }

    if ((page.viewportSize()?.width ?? 1024) < 768) {
      const mobileDashboardLayout = await page.evaluate(() => {
        const hero = document.querySelector('.dashboard-player-header')
        const badges = document.querySelector('.dashboard-profile-badges-section')
        const nav = document.querySelector('.dashboard-section-nav')
        const panel = document.querySelector('.dashboard-view-panel.active')
        const trophyCabinet = document.querySelector('.trophy-cabinet')
        const levelTabs = document.querySelector('.performance-level-tabs')
        const missionRail = document.querySelector('.mission-board-grid')
        const heroRect = hero?.getBoundingClientRect()
        const badgesRect = badges?.getBoundingClientRect()
        const navRect = nav?.getBoundingClientRect()
        const panelRect = panel?.getBoundingClientRect()

        return {
          navPosition: nav ? window.getComputedStyle(nav).position : '',
          navColumns: nav ? window.getComputedStyle(nav).gridTemplateColumns.split(' ').length : 0,
          navTop: navRect?.top ?? 0,
          heroTop: heroRect?.top ?? 0,
          badgesTop: badgesRect?.top ?? 0,
          panelTop: panelRect?.top ?? 0,
          trophyDisplay: trophyCabinet ? window.getComputedStyle(trophyCabinet).display : '',
          levelTabsDisplay: levelTabs ? window.getComputedStyle(levelTabs).display : '',
          levelTabsOverflow: levelTabs ? window.getComputedStyle(levelTabs).overflowX : '',
          missionRailDisplay: missionRail ? window.getComputedStyle(missionRail).display : '',
          missionRailOverflow: missionRail ? window.getComputedStyle(missionRail).overflowX : '',
        }
      })

      expect(mobileDashboardLayout.navPosition).toBe('sticky')
      expect(mobileDashboardLayout.navColumns).toBe(4)

      if (view.name === 'dashboard-overview') {
        expect(mobileDashboardLayout.navTop).toBeLessThan(mobileDashboardLayout.heroTop)
        expect(mobileDashboardLayout.heroTop).toBeLessThan(mobileDashboardLayout.badgesTop)
        expect(mobileDashboardLayout.badgesTop).toBeLessThan(mobileDashboardLayout.panelTop)
      }

      if (view.name === 'dashboard-stats') {
        expect(mobileDashboardLayout.levelTabsDisplay).toBe('flex')
        expect(['auto', 'scroll']).toContain(mobileDashboardLayout.levelTabsOverflow)
      }

      if (view.name === 'dashboard-missions') {
        expect(mobileDashboardLayout.trophyDisplay).not.toBe('none')
        expect(mobileDashboardLayout.missionRailDisplay).toBe('flex')
        expect(['auto', 'scroll']).toContain(mobileDashboardLayout.missionRailOverflow)
        const visibleFamilyBadges = await page.locator('.trophy-cabinet .badge-objective-card').count()
        const allBadgesTab = page.getByRole('tab', { name: /^Tous/i })
        await allBadgesTab.click()
        await expect(allBadgesTab).toHaveAttribute('aria-selected', 'true')
        expect(await page.locator('.trophy-cabinet .badge-objective-card').count()).toBeGreaterThan(visibleFamilyBadges)
        const firstBadge = page.locator('.trophy-cabinet .badge-objective-card').first()
        await expect(firstBadge).toBeVisible()
        await firstBadge.click()
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

    if (view.name === 'dashboard-missions') {
      const missionCards = page.locator('.mission-xp-card')
      await expect(missionCards).toHaveCount(3)
      await expect(missionCards.first().locator('.mission-tag-row em')).toHaveCount(5)
      const prepareMissionLink = missionCards.first().getByRole('link', { name: /^Préparer$/i })
      await expect(prepareMissionLink).toHaveAttribute('href', /\/jeu\/(solo|multijoueur)\?/)
      expect(await prepareMissionLink.evaluate((link) => Boolean(link.closest('button')))).toBe(false)
    }

    if (view.name === 'dashboard-stats') {
      const operationRow = page.locator('.performance-mode-row').first()
      await operationRow.click()
      await expect(operationRow).toHaveAttribute('aria-expanded', 'true')

      const isPhone = (page.viewportSize()?.width ?? 1024) < 768
      const operationDetail = page.getByRole(isPhone ? 'dialog' : 'region', { name: /Détail .+ · .+/i })
      await expect(operationDetail).toBeVisible()
      await expect(operationDetail.getByRole('group', { name: /Mesure du graphique/i })).toBeVisible()
      await operationDetail.getByRole('button', { name: /^Temps$/i }).click()
      await expect(operationDetail.getByRole('button', { name: /^Temps$/i })).toHaveAttribute('aria-pressed', 'true')
      const chartPoint = operationDetail.locator('.operation-insight-point').last()
      await expect(chartPoint).toBeVisible()
      await chartPoint.click()
      await expect(operationDetail.locator('.operation-insight-tooltip')).toBeVisible()

      if (isPhone) {
        await expect(operationDetail).toHaveAttribute('aria-modal', 'true')
        const dialogLayout = await operationDetail.evaluate((dialog) => {
          const rect = dialog.getBoundingClientRect()
          return {
            position: window.getComputedStyle(dialog).position,
            left: rect.left,
            right: rect.right,
            bottom: rect.bottom,
            innerWidth: window.innerWidth,
            innerHeight: window.innerHeight,
          }
        })
        expect(dialogLayout.position).toBe('fixed')
        expect(dialogLayout.left).toBeGreaterThanOrEqual(0)
        expect(dialogLayout.right).toBeLessThanOrEqual(dialogLayout.innerWidth + 1)
        expect(dialogLayout.bottom).toBeLessThanOrEqual(dialogLayout.innerHeight + 1)
      }

      await attachScreenshot(page, testInfo, 'dashboard-operation-detail')
      const closeDetail = isPhone
        ? operationDetail.getByRole('button', { name: /Fermer le détail de l’opération/i })
        : operationDetail.getByRole('button', { name: /Retour au niveau/i })
      await closeDetail.click()
      await expect(operationDetail).toHaveCount(0)
    }

    await expectNoHorizontalOverflow(page, view.name)
    await attachScreenshot(page, testInfo, view.name)
  }
})

test('solo setup puis arene restent utilisables', async ({ page }, testInfo) => {
  await page.goto(`${APP_URL}/jeu/solo`)
  await expect(page.getByRole('button', { name: /Commencer le sprint/i })).toBeVisible()
  const dailyMissionCards = page.locator('.solo-daily-objective')
  await expect(dailyMissionCards).toHaveCount(3)
  await expect(dailyMissionCards.first().locator('.mission-tag-row em')).toHaveCount(5)
  await dailyMissionCards.first().click()
  await expect(page.getByRole('button', { name: /Préparer la mission/i })).toBeVisible()
  expect(await dailyMissionCards.first().locator('button').count()).toBe(0)
  await dailyMissionCards.first().click()
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

  const helpButton = page.getByRole('button', { name: /Informations sur les modes de jeu/i })
  await expect(helpButton).toBeVisible()
  await helpButton.click()
  const helpDialog = page.getByRole('dialog', { name: /Sprint/i })
  await expect(helpDialog).toBeVisible()
  await expect(helpDialog).toContainText(/plus grand nombre de questions/i)
  await expect(helpDialog.getByLabel(/Duree Sprint/i)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(helpDialog).toHaveCount(0)

  const startButton = page.getByRole('button', { name: /Commencer le sprint/i })
  const idleAnimations = await startButton.evaluate((button) => (
    button.getAnimations({ subtree: true }).map((animation) => (
      animation instanceof CSSAnimation ? animation.animationName : ''
    ))
  ))
  expect(idleAnimations).toContain('launch-action-breathe')

  await startButton.click()
  await expect(page.locator('.launch-action-burst')).toBeVisible()
  await attachScreenshot(page, testInfo, 'solo-launch-animation')
  await expect(page.locator('.question-line')).toBeVisible()
  await expect(page.getByLabel('0 réponses données, 0 bonnes réponses')).toBeVisible()
  await expect(page.getByRole('textbox', { name: /Votre reponse/i })).toBeFocused()
  await expectNoHorizontalOverflow(page, 'solo arena')
  await attachScreenshot(page, testInfo, 'solo-arena')

  const prompt = await page.locator('.question-line').innerText()
  await page.getByRole('textbox', { name: /Votre reponse/i }).fill(String(solvePrompt(prompt)))
  await page.getByRole('button', { name: /Valider/i }).click()
  await expect(page.getByRole('textbox', { name: /Votre reponse/i })).toBeFocused()
  await expect(page.getByLabel('1 réponse donnée, 1 bonne réponse')).toBeVisible()
})

test('amis et profil restent lisibles sans debordement', async ({ page }, testInfo) => {
  await page.goto(`${APP_URL}/amis`)
  await expect(page.getByRole('button', { name: /Mes amis/i })).toBeVisible()
  if ((page.viewportSize()?.width ?? 1024) < 768) {
    await expect(page.locator('.profile-card-scroller').or(page.locator('.friends-empty-panel'))).toBeVisible()
    const rosterItem = page.locator('.social-roster-item').first()
    if (await rosterItem.count()) {
      await expect(page.locator('.social-profile-detail')).toBeHidden()
      await rosterItem.click()
      const mobileDetail = page.locator('.social-profile-detail.mobile-open')
      await expect(mobileDetail).toBeVisible()

      const detailLayout = await mobileDetail.evaluate((card) => {
        const rect = card.getBoundingClientRect()
        const actions = card.querySelector('.profile-card-actions')
        return {
          left: rect.left,
          right: rect.right,
          bottom: rect.bottom,
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          actionsColumns: actions ? window.getComputedStyle(actions).gridTemplateColumns.split(' ').length : 0,
        }
      })

      expect(detailLayout.left).toBeGreaterThanOrEqual(0)
      expect(detailLayout.right).toBeLessThanOrEqual(detailLayout.innerWidth + 1)
      expect(detailLayout.bottom).toBeLessThan(detailLayout.innerHeight)
      expect(detailLayout.actionsColumns).toBe(2)
      await attachScreenshot(page, testInfo, 'friends-mobile-detail')
      await page.getByRole('button', { name: /Fermer le profil/i }).last().click()
      await expect(mobileDetail).toBeHidden()
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
      const comparison = document.querySelector('.friend-versus-record')
      const badgeGrid = document.querySelector('.friend-badge-grid')
      const operationGrid = document.querySelector('.friend-operation-strip')
      const levelGrid = document.querySelector('.friend-level-rail')
      const duelHistory = document.querySelector('.friend-duel-history')
      const heroRect = hero?.getBoundingClientRect()

      return {
        heroColumns: hero ? window.getComputedStyle(hero).gridTemplateColumns.split(' ').length : 0,
        heroRight: heroRect?.right ?? 0,
        comparisonDisplay: comparison ? window.getComputedStyle(comparison).display : '',
        comparisonColumns: comparison ? window.getComputedStyle(comparison).gridTemplateColumns.split(' ').length : 0,
        badgeDisplay: badgeGrid ? window.getComputedStyle(badgeGrid).display : '',
        badgeOverflowX: badgeGrid ? window.getComputedStyle(badgeGrid).overflowX : '',
        operationDisplay: operationGrid ? window.getComputedStyle(operationGrid).display : '',
        operationColumns: operationGrid ? window.getComputedStyle(operationGrid).gridTemplateColumns.split(' ').length : 0,
        levelDisplay: levelGrid ? window.getComputedStyle(levelGrid).display : '',
        levelColumns: levelGrid ? window.getComputedStyle(levelGrid).gridTemplateColumns.split(' ').length : 0,
        duelHistoryDisplay: duelHistory ? window.getComputedStyle(duelHistory).display : '',
        innerWidth: window.innerWidth,
      }
    })

    expect(friendProfileLayout.heroColumns).toBe(1)
    expect(friendProfileLayout.heroRight).toBeLessThanOrEqual(friendProfileLayout.innerWidth + 1)
    expect(friendProfileLayout.comparisonDisplay).toBe('grid')
    expect(friendProfileLayout.comparisonColumns).toBe(3)
    expect(friendProfileLayout.badgeDisplay).toBe('flex')
    expect(['auto', 'scroll']).toContain(friendProfileLayout.badgeOverflowX)
    expect(friendProfileLayout.operationDisplay).toBe('grid')
    expect(friendProfileLayout.operationColumns).toBe(1)
    expect(friendProfileLayout.levelDisplay).toBe('grid')
    expect(friendProfileLayout.levelColumns).toBe(1)
    expect(friendProfileLayout.duelHistoryDisplay).toBe('grid')

    await expectNoHorizontalOverflow(page, 'friend profile')
    await attachScreenshot(page, testInfo, 'friend-profile')
  } else {
    await expectNoHorizontalOverflow(page, 'friends')
    await attachScreenshot(page, testInfo, 'friends')
  }

  await page.goto(`${APP_URL}/profil/configuration`)
  const firstNameInput = page.getByLabel(/Prenom|Pr.*nom/i)
  await expect(firstNameInput).toBeVisible()
  await expect(page.locator('.profile-save-bar')).toHaveCount(0)
  await firstNameInput.fill(`${await firstNameInput.inputValue()}a`)
  await expect(page.getByRole('button', { name: /^Enregistrer$/i })).toBeVisible()
  await expectNoHorizontalOverflow(page, 'profile')
  await attachScreenshot(page, testInfo, 'profile')
})

test('multijoueur lobby room et arene restent utilisables', async ({ page, browser }, testInfo) => {
  test.setTimeout(60_000)

  const viewport = page.viewportSize() ?? { width: 390, height: 844 }
  const guest = await authenticatedPage(browser, 'guest', viewport)

  try {
    await page.goto(`${APP_URL}/jeu/multijoueur`)
    await guest.page.goto(`${APP_URL}/jeu/multijoueur`)
    await Promise.all([waitForRealtimeReady(page), waitForRealtimeReady(guest.page)])
    await expect(page.locator('.multiplayer-lobby-grid')).toBeVisible()
    await expectNoHorizontalOverflow(page, 'multiplayer lobby')
    await attachScreenshot(page, testInfo, 'multiplayer-lobby')

    if ((viewport.width ?? 1024) < 768) {
      await expect(page.getByRole('button', { name: /Bob Guest/i })).toBeVisible()

      const mobileLobbyLayout = await page.evaluate(() => {
        const directList = document.querySelector('.multiplayer-direct-list')
        const titleRow = document.querySelector('.multiplayer-lobby-title-row')
        const createButton = titleRow?.querySelector('button')
        const heading = titleRow?.querySelector('h1')
        const emptyInvitations = document.querySelector('.multiplayer-challenge-list.is-empty')
        const emptyIllustration = emptyInvitations?.querySelector('.multiplayer-inbox-empty')
        const titleRowRect = titleRow?.getBoundingClientRect()
        const createButtonRect = createButton?.getBoundingClientRect()
        const headingRect = heading?.getBoundingClientRect()
        const emptyInvitationsRect = emptyInvitations?.getBoundingClientRect()

        return {
          directListDisplay: directList ? window.getComputedStyle(directList).display : '',
          directListOverflowX: directList ? window.getComputedStyle(directList).overflowX : '',
          titleColumns: titleRow ? window.getComputedStyle(titleRow).gridTemplateColumns.split(' ').length : 0,
          createButtonWidth: createButtonRect?.width ?? 0,
          createButtonHeight: createButtonRect?.height ?? 0,
          headingHeight: headingRect?.height ?? 0,
          emptyInvitationsHeight: emptyInvitationsRect?.height ?? 0,
          emptyIllustrationDisplay: emptyIllustration ? window.getComputedStyle(emptyIllustration).display : '',
          titleRowWidth: titleRowRect?.width ?? 0,
        }
      })

      expect(mobileLobbyLayout.directListDisplay).toBe('flex')
      expect(mobileLobbyLayout.directListOverflowX).toBe('auto')
      expect(mobileLobbyLayout.titleColumns).toBe(2)
      expect(mobileLobbyLayout.createButtonWidth).toBeLessThan(mobileLobbyLayout.titleRowWidth)
      expect(mobileLobbyLayout.createButtonWidth).toBeLessThan(150)
      expect(mobileLobbyLayout.createButtonHeight).toBeLessThanOrEqual(44)
      expect(mobileLobbyLayout.headingHeight).toBeLessThanOrEqual(32)
      expect(mobileLobbyLayout.emptyInvitationsHeight).toBeLessThan(120)
      expect(mobileLobbyLayout.emptyIllustrationDisplay).toBe('none')
      await page.getByRole('button', { name: /^Commencer un nouveau défi$/i }).click()
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
    await expect(page.getByRole('button', { name: /Annuler l'invitation/i })).toBeVisible()
    await waitForRealtimeReady(page)
    await guest.page.goto(page.url())
    await waitForRealtimeReady(guest.page)
    await guest.page.getByRole('button', { name: /Entrer dans le salon/i }).click()
    await expect(page.locator('.multiplayer-room-grid')).toBeVisible()
    await expect(guest.page.getByText(/En attente du maitre du salon/i).first()).toBeVisible()
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
    const proposeButton = page.getByRole('button', { name: /Proposer le defi/i })
    await expect(proposeButton).toHaveClass(/launch-action-button/)
    await proposeButton.click()
    await expect(page.locator('.launch-action-burst')).toBeVisible()
    await expect(guest.page.getByRole('button', { name: /Accepter le defi/i })).toBeVisible()
    const acceptButton = guest.page.getByRole('button', { name: /Accepter le defi/i })
    await expect(acceptButton).toHaveClass(/launch-action-button/)
    await acceptButton.click()
    await expect(guest.page.locator('.launch-action-burst')).toBeVisible()
    await attachScreenshot(guest.page, testInfo, 'multiplayer-launch-animation')

    await expect(page.locator('.challenge-arena')).toBeVisible()
    await expect(page.getByRole('button', { name: /^Stop$/i }).first()).toBeVisible()
    await expectNoHorizontalOverflow(page, 'multiplayer arena host')
    await attachScreenshot(page, testInfo, 'multiplayer-arena')
  } finally {
    await guest.context.close()
  }
})
