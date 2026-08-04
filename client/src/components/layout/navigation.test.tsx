import { describe, expect, it } from 'vitest'
import { DEFAULT_AUTHENTICATED_ROUTE } from '../../lib/routes'
import { mainNavigationItems, navigationItemsForAccess } from './navigation'

describe('mainNavigationItems', () => {
  it('place Jouer en premier et ouvre le mode Solo par defaut', () => {
    expect(mainNavigationItems[0]).toMatchObject({
      label: 'Jouer',
      to: DEFAULT_AUTHENTICATED_ROUTE,
    })
    expect(mainNavigationItems.map((item) => item.label)).toEqual(['Jouer', 'Mon espace', 'Amis'])
  })

  it('ajoute l administration uniquement pour un compte autorise', () => {
    expect(navigationItemsForAccess(false).map((item) => item.label)).not.toContain('Administration')
    expect(navigationItemsForAccess(true).map((item) => item.label)).toContain('Administration')
  })
})
