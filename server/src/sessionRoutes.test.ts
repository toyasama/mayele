import type { RequestHandler } from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockAuth } from './middleware/auth.js'

vi.mock('./services/playerService.js', () => ({
  getOrCreatePlayer: vi.fn(async () => ({ id: 'player-1' })),
}))

vi.mock('./services/sessionService.js', () => ({
  saveSession: vi.fn(async () => ({ message: 'Session enregistrée.', earnedAchievements: [] })),
}))

const { createApp } = await import('./app.js')
const { saveSession } = await import('./services/sessionService.js')

const noopClerk: RequestHandler = (_req, _res, next) => next()

function buildLargeValidSessionPayload() {
  const answer = {
    prompt: '1234567890 + 1234567890 + 1234567890 + 1234567890 + 1234567890 + 1234567890',
    correctAnswer: 60,
    userAnswer: 60,
    responseTimeMs: 500,
    game: 'addition',
    level: 'debutant',
    skill: 'addition',
    isCorrect: true,
  }

  return {
    game: 'mixte',
    level: 'debutant',
    practiceSkill: null,
    score: 100,
    points: 100000,
    correctAnswers: 500,
    totalQuestions: 500,
    durationSeconds: 60,
    bestStreak: 500,
    answers: Array.from({ length: 500 }, () => answer),
  }
}

describe('session routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('saves a valid full sprint payload instead of failing on body size', async () => {
    const app = createApp({ clerkMiddlewareOverride: noopClerk, authMiddlewareOverride: mockAuth('user-1') })

    await request(app).post('/api/sessions').send(buildLargeValidSessionPayload()).expect(201, {
      message: 'Session enregistrée.',
      earnedAchievements: [],
    })

    expect(saveSession).toHaveBeenCalledOnce()
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
