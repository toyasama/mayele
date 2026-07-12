import type { RequestHandler } from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockAuth } from './middleware/auth.js'

const saveSessionResult = {
  message: 'Session enregistrée.',
  scorePoints: 42,
  xpEarned: 120,
  missionXpEarned: 0,
  completedMissions: [],
  playerProgress: {
    level: 2,
    maxLevel: 100,
    totalXp: 120,
    currentLevelXp: 120,
    nextLevel: 3,
    nextLevelXp: 432,
    xpIntoLevel: 0,
    xpForNextLevel: 312,
    xpRemaining: 312,
    progress: 0,
    isMaxLevel: false,
  },
  earnedAchievements: [],
}

vi.mock('./services/playerService.js', () => ({
  getOrCreatePlayer: vi.fn(async () => ({ id: 'player-1', timeZone: 'America/New_York' })),
  isPlayerProfileComplete: vi.fn(() => true),
}))

vi.mock('./services/sessionService.js', () => ({
  saveSession: vi.fn(async () => saveSessionResult),
}))

const { createApp } = await import('./app.js')
const { saveSession } = await import('./services/sessionService.js')

const noopClerk: RequestHandler = (_req, _res, next) => next()

function buildValidSessionPayload(count = 30) {
  const answer = {
    prompt: '12 + 8',
    correctAnswer: 20,
    userAnswer: 20,
    responseTimeMs: 500,
    game: 'addition',
    level: 'debutant',
    skill: 'addition',
  }

  return {
    game: 'mixte',
    level: 'debutant',
    practiceSkill: null,
    totalQuestions: count,
    durationSeconds: 60,
    bestStreak: count,
    answers: Array.from({ length: count }, () => answer),
  }
}

describe('session routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('accepte un payload valide de 30 réponses', async () => {
    const app = createApp({ clerkMiddlewareOverride: noopClerk, authMiddlewareOverride: mockAuth('user-1') })

    await request(app).post('/api/sessions').send(buildValidSessionPayload(30)).expect(201, saveSessionResult)

    expect(saveSession).toHaveBeenCalledOnce()
    expect(saveSession).toHaveBeenCalledWith('player-1', expect.any(Object), 'America/New_York')
  })

  it('rejette un payload dépassant la limite de 120 réponses', async () => {
    const app = createApp({ clerkMiddlewareOverride: noopClerk, authMiddlewareOverride: mockAuth('user-1') })

    await request(app)
      .post('/api/sessions')
      .send(buildValidSessionPayload(121))
      .expect(400)

    expect(saveSession).not.toHaveBeenCalled()
  })

  it('returns 413 for payloads beyond the configured API limit', async () => {
    const app = createApp({ clerkMiddlewareOverride: noopClerk, authMiddlewareOverride: mockAuth('user-1') })

    await request(app)
      .post('/api/sessions')
      .send({ oversized: 'x'.repeat(600 * 1024) })
      .expect(413, { message: 'Payload trop volumineux.', code: 'payload_too_large' })

    expect(saveSession).not.toHaveBeenCalled()
  })
})
