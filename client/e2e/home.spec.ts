import { expect, test } from '@playwright/test'

test('redirige l utilisateur E2E authentifie vers le jeu solo', async ({ page }) => {
  await page.goto('/')

  await expect(page).toHaveURL(/\/jeu\/solo$/)
  await expect(page.locator('.game-page')).toBeVisible()
})
