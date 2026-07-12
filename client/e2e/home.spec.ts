import { expect, test } from '@playwright/test'

test('affiche la page d accueil publique', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: /Calculez vite|Alice Host/i })).toBeVisible()
})
