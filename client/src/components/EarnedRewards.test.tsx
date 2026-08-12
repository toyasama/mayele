import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { EarnedRewards } from './EarnedRewards'

afterEach(cleanup)

describe('EarnedRewards', () => {
  it('shows missions and badges completed by the player', () => {
    render(
      <EarnedRewards
        rewards={{
          missionXpEarned: 80,
          completedMissions: [{ key: 'mission-1', title: 'Calcul précis', rewardXp: 80 }],
          completedBadges: [{ key: 'badge-1', title: 'Série stable', familyLabel: 'Séries' }],
          earnedAchievements: [],
        }}
      />,
    )

    const rewards = screen.getByRole('region', { name: 'Récompenses obtenues' })
    expect(within(rewards).getByText('Calcul précis')).toBeVisible()
    expect(within(rewards).getByText('+80 XP')).toBeVisible()
    expect(within(rewards).getByText('Série stable')).toBeVisible()
    expect(within(rewards).getByText('Badge débloqué · Séries')).toBeVisible()
  })

  it('renders nothing when the session did not complete a reward', () => {
    const { container } = render(
      <EarnedRewards
        rewards={{
          missionXpEarned: 0,
          completedMissions: [],
          completedBadges: [],
          earnedAchievements: [],
        }}
      />,
    )

    expect(container).toBeEmptyDOMElement()
  })
})
