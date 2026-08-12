import { describe, expect, it } from 'vitest'
import { serializeSessionRewards } from './matchPresenter.js'

describe('serializeSessionRewards', () => {
  it('exposes only validated mission and badge rewards from the canonical session result', () => {
    expect(serializeSessionRewards({
      missionXpEarned: 80,
      completedMissions: [
        { key: 'mission-1', title: 'Calcul précis', rewardXp: 80 },
        { key: null, title: 'Invalide', rewardXp: 10 },
      ],
      completedBadges: [{ key: 'badge-1', title: 'Série stable', familyLabel: 'Séries' }],
      earnedAchievements: [{ key: 'first_sprint', label: 'Premier sprint' }],
    })).toEqual({
      missionXpEarned: 80,
      completedMissions: [{ key: 'mission-1', title: 'Calcul précis', rewardXp: 80 }],
      completedBadges: [{ key: 'badge-1', title: 'Série stable', familyLabel: 'Séries' }],
      earnedAchievements: [{ key: 'first_sprint', label: 'Premier sprint' }],
    })
  })

  it('keeps old sessions compatible when no badge field was stored', () => {
    expect(serializeSessionRewards({ completedMissions: [], earnedAchievements: [] })).toEqual({
      missionXpEarned: 0,
      completedMissions: [],
      completedBadges: [],
      earnedAchievements: [],
    })
    expect(serializeSessionRewards(null)).toBeNull()
  })
})
