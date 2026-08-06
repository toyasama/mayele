import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

function readStylesheet(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

const routeEntries = {
  admin: readStylesheet('./routes/admin.css'),
  auth: readStylesheet('./routes/auth.css'),
  dashboard: readStylesheet('./routes/dashboard.css'),
  friendProfile: readStylesheet('./routes/friend-profile.css'),
  friends: readStylesheet('./routes/friends.css'),
  game: readStylesheet('./routes/game.css'),
  multiplayer: readStylesheet('./routes/multiplayer.css'),
  profileSettings: readStylesheet('./routes/profile-settings.css'),
}

describe('route CSS splitting', () => {
  it('keeps feature-only styles out of the initial stylesheet', () => {
    const globalCss = readStylesheet('../index.css')
    const deferredStyles = [
      'auth-v2.css',
      'challenge-experience.css',
      'dashboard-core.css',
      'dashboard-header-v2.css',
      'dashboard-information.css',
      'dashboard-stats.css',
      'experience-architecture.css',
      'game-core.css',
      'multiplayer-mobile.css',
      'multiplayer-v3.css',
      'profile-settings-v2.css',
      'social-v2.css',
      'social.css',
      'solo-results-v2.css',
      'sprint-dashboard-refinements.css',
    ]

    for (const stylesheet of deferredStyles) {
      expect(globalCss).not.toContain(stylesheet)
    }
  })

  it('declares a dedicated stylesheet entry for every lazy feature family', () => {
    expect(routeEntries.auth).toContain('auth-v2.css')
    expect(routeEntries.admin).toContain('admin.css')
    expect(routeEntries.dashboard).toContain('dashboard-core.css')
    expect(routeEntries.dashboard).toContain('dashboard-stats.css')
    expect(routeEntries.dashboard).toContain('experience-architecture.css')
    expect(routeEntries.friends).toContain('social.css')
    expect(routeEntries.friendProfile).toContain('social-v2.css')
    expect(routeEntries.friendProfile).toContain('friend-profile-navigation.css')
    expect(routeEntries.game).toContain('challenge-experience.css')
    expect(routeEntries.game).toContain('solo-results-v2.css')
    expect(routeEntries.multiplayer).toContain('multiplayer-mobile.css')
    expect(routeEntries.multiplayer).toContain('multiplayer-v3.css')
    expect(routeEntries.profileSettings).toContain('profile-settings-v2.css')
  })
})
