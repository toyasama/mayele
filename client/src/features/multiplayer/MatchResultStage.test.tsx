import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MatchParticipantData } from '../../lib/api'
import { MatchResultStage } from './MatchResultStage'

afterEach(cleanup)

function participant(overrides: Partial<MatchParticipantData> = {}): MatchParticipantData {
  return {
    id: 'participant-1',
    status: 'completed',
    preferredChallengeMode: null,
    preferredGame: null,
    preferredLevel: null,
    score: 100,
    scorePoints: 300,
    xp: 90,
    correctAnswers: 10,
    totalQuestions: 10,
    totalResponseTimeMs: 8_000,
    bestStreak: 10,
    joinedAt: null,
    finishedAt: null,
    forfeitedAt: null,
    rematchRequestedAt: null,
    resultDismissedAt: null,
    challengeStats: {
      room: { wins: 1, losses: 0, draws: 0 },
      friendship: { wins: 1, losses: 0, draws: 0 },
    },
    player: {
      id: 'player-1',
      name: 'Joueur',
      username: null,
      avatarUrl: null,
      totalXp: 500,
      presenceStatus: 'online',
      presenceUpdatedAt: '2026-08-12T12:00:00.000Z',
    },
    ...overrides,
  }
}

describe('MatchResultStage', () => {
  it('shows only the current player rewards', () => {
    render(
      <MatchResultStage
        self={participant({
          rewards: {
            missionXpEarned: 40,
            completedMissions: [{ key: 'mission-1', title: 'Mission multi', rewardXp: 40 }],
            completedBadges: [],
            earnedAchievements: [],
          },
        })}
        opponent={participant({
          id: 'participant-2',
          player: { ...participant().player, id: 'player-2', name: 'Adversaire' },
          rewards: {
            missionXpEarned: 100,
            completedMissions: [{ key: 'mission-2', title: 'Récompense adverse', rewardXp: 100 }],
            completedBadges: [],
            earnedAchievements: [],
          },
        })}
        opponentName="Adversaire"
        selfOutcome="winner"
        opponentOutcome="loser"
        selfForfeited={false}
        opponentForfeited={false}
        opponentDismissed={false}
        rematchRequested={false}
        opponentRematchRequested={false}
        rematchPending={false}
        onRematch={vi.fn()}
        onLeave={vi.fn()}
      />,
    )

    expect(screen.getByText('Mission multi')).toBeVisible()
    expect(screen.queryByText('Récompense adverse')).not.toBeInTheDocument()
  })
})
