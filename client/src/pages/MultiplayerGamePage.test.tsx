import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiRequestError, type AuthUser, type MatchData, type PublicPlayer } from '../lib/api'
import { MultiplayerGamePage } from './MultiplayerGamePage'

const realtimeMocks = vi.hoisted(() => {
  const resolvedCommand = vi.fn(async () => ({}))

  return {
    options: null as Record<string, ((...args: unknown[]) => unknown) | undefined> | null,
    commands: {
      acceptMatchInvitation: resolvedCommand,
      acceptMatchProposal: resolvedCommand,
      createMatchInvitation: resolvedCommand,
      declineMatchInvitation: resolvedCommand,
      declineMatchProposal: resolvedCommand,
      forfeitMatch: resolvedCommand,
      isRealtimeReady: true,
      joinRoom: vi.fn(async () => ({ joined: true })),
      leaveMatch: resolvedCommand,
      proposeMatch: resolvedCommand,
      requestMatchRematch: resolvedCommand,
      submitMatchResult: vi.fn(),
      submitSprintAnswer: vi.fn(),
      submitTempoAnswer: resolvedCommand,
      updateMatchConfig: resolvedCommand,
      updateMatchProgress: resolvedCommand,
    },
  }
})

const apiMocks = vi.hoisted(() => ({
  getMatch: vi.fn(),
  getMatchRoomOverview: vi.fn(),
  heartbeatMatch: vi.fn(),
}))

const profile = vi.hoisted(() => ({
  id: 'host',
  clerkUserId: 'user_host',
  name: 'Alice Host',
  firstName: 'Alice',
  lastName: 'Host',
  birthDate: '2000-01-01',
  username: 'alice-host',
  avatarUrl: null,
  timeZone: 'Europe/Paris',
  presenceStatus: 'online' as const,
  presenceUpdatedAt: '2026-08-05T10:00:00.000Z',
  email: 'alice@example.test',
  profileComplete: true,
  createdAt: '2026-08-05T10:00:00.000Z',
})) satisfies AuthUser

const host: PublicPlayer = {
  id: profile.id,
  name: profile.name,
  username: profile.username,
  avatarUrl: profile.avatarUrl,
  totalXp: 0,
  presenceStatus: profile.presenceStatus,
  presenceUpdatedAt: profile.presenceUpdatedAt,
}

const guest: PublicPlayer = {
  id: 'guest',
  name: 'Bob Guest',
  username: 'bob-guest',
  avatarUrl: null,
  totalXp: 0,
  presenceStatus: 'online',
  presenceUpdatedAt: '2026-08-05T10:00:00.000Z',
}

const getToken = vi.hoisted(() => vi.fn(async () => 'token'))

vi.mock('../context/auth', () => ({
  useAuth: () => ({ getToken, isAuthenticated: true }),
}))

vi.mock('../context/profile-context', () => ({
  useProfile: () => ({ profile }),
}))

vi.mock('../hooks/useRealtimeEvents', () => ({
  useRealtimeEvents: (options: Record<string, ((...args: unknown[]) => unknown) | undefined>) => {
    realtimeMocks.options = options
    return realtimeMocks.commands
  },
}))

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()

  return {
    ...actual,
    api: {
      ...actual.api,
      ...apiMocks,
    },
  }
})

function participant(player: PublicPlayer, status: string) {
  return {
    id: `participant-${player.id}`,
    status,
    preferredChallengeMode: null,
    preferredGame: null,
    preferredLevel: null,
    score: status === 'completed' ? 90 : null,
    scorePoints: status === 'completed' ? 175 : 0,
    xp: status === 'completed' ? 150 : null,
    correctAnswers: status === 'completed' ? 25 : 0,
    totalQuestions: status === 'completed' ? 27 : 0,
    totalResponseTimeMs: 0,
    bestStreak: status === 'completed' ? 16 : 0,
    joinedAt: '2026-08-05T10:00:00.000Z',
    finishedAt: status === 'completed' ? '2026-08-05T10:01:00.000Z' : null,
    forfeitedAt: null,
    rematchRequestedAt: null,
    resultDismissedAt: null,
    challengeStats: {
      room: { wins: 0, losses: 0, draws: 0 },
      friendship: { wins: 0, losses: 0, draws: 0 },
    },
    player,
  }
}

function activeMatch(): MatchData {
  const now = new Date()

  return {
    id: 'match-1',
    roomId: 'room-1',
    type: 'challenge',
    challengeMode: 'sprint',
    status: 'in_progress',
    game: 'addition',
    level: 'debutant',
    practiceSkill: null,
    durationSeconds: 60,
    questionCount: null,
    perQuestionTimeLimitSeconds: null,
    questionSeed: 'seed-1',
    tempoQuestionIndex: null,
    tempoQuestionStartedAt: null,
    configVersion: 1,
    winnerPlayerId: null,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 120_000).toISOString(),
    endsAt: new Date(now.getTime() + 60_000).toISOString(),
    serverNow: now.toISOString(),
    hostActiveAt: now.toISOString(),
    startedAt: now.toISOString(),
    finishedAt: null,
    createdBy: host,
    participants: [participant(host, 'playing'), participant(guest, 'playing')],
  } as MatchData
}

function completedMatch(match: MatchData): MatchData {
  return {
    ...match,
    status: 'completed',
    winnerPlayerId: host.id,
    serverNow: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    participants: [participant(host, 'completed'), participant(guest, 'completed')],
  } as MatchData
}

describe('MultiplayerGamePage finalization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    realtimeMocks.options = null
    realtimeMocks.commands.submitMatchResult.mockReset()
    realtimeMocks.commands.submitSprintAnswer.mockReset()
    realtimeMocks.commands.joinRoom.mockResolvedValue({ joined: true })
    apiMocks.heartbeatMatch.mockResolvedValue({ match: activeMatch() })
    Object.defineProperty(window, 'scrollTo', { configurable: true, value: vi.fn() })
  })

  afterEach(cleanup)

  it('ouvre le configurateur multijoueur avec le preset Tempo de la mission', async () => {
    apiMocks.getMatchRoomOverview.mockResolvedValue({ friends: [guest], matches: [] })

    render(
      <MemoryRouter initialEntries={['/jeu/multijoueur?mission=daily-v2&playContext=multiplayer&mode=tempo&game=division&level=expert&questions=50&questionSeconds=5']}>
        <MultiplayerGamePage />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('spinbutton', { name: 'Questions' })).toHaveValue(50)
    expect(screen.getByRole('spinbutton', { name: 'Secondes par question' })).toHaveValue(5)
    expect(screen.getByRole('button', { name: /Division/ })).toHaveClass('active')
    expect(screen.getByRole('button', { name: /Expert/ })).toHaveClass('active')
  })

  it("n'affiche pas l'expiration tardive d'une reponse apres la fin confirmee du defi", async () => {
    const match = activeMatch()
    let rejectAnswer!: (reason: unknown) => void
    realtimeMocks.commands.submitSprintAnswer.mockImplementationOnce(() => new Promise((_resolve, reject) => {
      rejectAnswer = reject
    }))
    apiMocks.getMatchRoomOverview.mockResolvedValue({ friends: [guest], matches: [match] })

    render(
      <MemoryRouter initialEntries={[`/jeu/multijoueur?match=${match.id}`]}>
        <MultiplayerGamePage />
      </MemoryRouter>,
    )

    const input = await screen.findByRole('textbox', { name: /Votre reponse/i })
    fireEvent.change(input, { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: /Valider/i }))
    await waitFor(() => expect(realtimeMocks.commands.submitSprintAnswer).toHaveBeenCalledOnce())

    act(() => {
      realtimeMocks.options?.onMatchChanged?.({ match: completedMatch(match) })
    })
    expect(await screen.findByText('Victoire')).toBeVisible()

    await act(async () => {
      rejectAnswer(new ApiRequestError('Commande temps reel expiree.', 0, 'realtime_timeout'))
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(screen.queryByText(/Commande temps reel expiree/i)).not.toBeInTheDocument()
    })
  })

  it("attend la derniere reponse sprint avant d'envoyer le resultat", async () => {
    const match = activeMatch()
    let resolveAnswer!: (value: { match: MatchData }) => void
    realtimeMocks.commands.submitSprintAnswer.mockImplementationOnce(() => new Promise((resolve) => {
      resolveAnswer = resolve
    }))
    realtimeMocks.commands.submitMatchResult.mockResolvedValueOnce({ match: completedMatch(match) })
    apiMocks.getMatchRoomOverview.mockResolvedValue({ friends: [guest], matches: [match] })

    render(
      <MemoryRouter initialEntries={[`/jeu/multijoueur?match=${match.id}`]}>
        <MultiplayerGamePage />
      </MemoryRouter>,
    )

    const input = await screen.findByRole('textbox', { name: /Votre reponse/i })
    fireEvent.change(input, { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: /Valider/i }))
    await waitFor(() => expect(realtimeMocks.commands.submitSprintAnswer).toHaveBeenCalledOnce())

    const endingMatch = {
      ...match,
      serverNow: new Date().toISOString(),
      endsAt: new Date(Date.now() + 100).toISOString(),
    }
    act(() => {
      realtimeMocks.options?.onMatchChanged?.({ match: endingMatch })
    })

    await new Promise((resolve) => window.setTimeout(resolve, 400))
    expect(realtimeMocks.commands.submitMatchResult).not.toHaveBeenCalled()

    await act(async () => {
      resolveAnswer({ match: endingMatch })
      await Promise.resolve()
    })

    await waitFor(() => expect(realtimeMocks.commands.submitMatchResult).toHaveBeenCalledOnce())
  })
})
