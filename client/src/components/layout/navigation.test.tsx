import { describe, expect, it } from 'vitest'
import { DEFAULT_AUTHENTICATED_ROUTE } from '../../lib/routes'
import { mainNavigationItems } from './navigation'

describe('mainNavigationItems', () => {
  it('place Jouer en premier et ouvre le mode Solo par defaut', () => {
    expect(mainNavigationItems[0]).toMatchObject({
      label: 'Jouer',
      to: DEFAULT_AUTHENTICATED_ROUTE,
    })
    expect(mainNavigationItems.map((item) => item.label)).toEqual(['Jouer', 'Mon espace', 'Amis'])
  })
})
