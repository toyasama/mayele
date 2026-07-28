import type { RequestHandler } from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockAuth } from './middleware/auth.js'

const run = {
  id: 'run-1',
  clientRunId: '6269d73b-0235-4d35-b3e3-887f80407c5d',
  status: 'active',
  question: { index: 0, prompt: '1 + 2', operation: 'addition', skill: 'addition' },
  progress: { correctAnswers: 0, totalQuestions: 0, scorePoints: 0, xp: 0, currentStreak: 0, bestStreak: 0 },
  answers: [],
  result: null,
}

const soloRunMocks = vi.hoisted(() => ({
  startSoloRun: vi.fn(async () => run),
  getActiveSoloRun: vi.fn(async () => run),
  getSoloRun: vi.fn(async () => run),
  submitSoloAnswer: vi.fn(async () => ({ run, correction: null })),
  finishSoloRun: vi.fn(async () => ({ ...run, status: 'completed' })),
}))

vi.mock('./services/playerService.js', () => ({
  getOrCreatePlayer: vi.fn(async () => ({
    id: 'player-1',
    firstName: 'Ada',
    lastName: 'Lovelace',
    birthDate: new Date('2000-01-01'),
    username: 'ada',
  })),
  isPlayerProfileComplete: vi.fn(() => true),
}))

vi.mock('./services/soloRunService.js', () => soloRunMocks)

const { createApp } = await import('./app.js')

const noopClerk: RequestHandler = (_req, _res, next) => next()

function testApp() {
  return createApp({ clerkMiddlewareOverride: noopClerk, authMiddlewareOverride: mockAuth('user-1') })
}

function validStartPayload() {
  return {
    clientRunId: '6269d73b-0235-4d35-b3e3-887f80407c5d',
    mode: 'tempo',
    game: 'addition',
    level: 'debutant',
    practiceSkill: null,
    sprintDurationSeconds: 60,
    tempoQuestionCount: 10,
    tempoQuestionSeconds: 5,
  }
}

describe('authoritative solo run routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('désactive la soumission legacy qui faisait confiance aux réponses du client', async () => {
    await request(testApp())
      .post('/api/sessions')
      .send({ answers: [{ correctAnswer: 999 }] })
      .expect(410, {
        message: 'Cette version de sauvegarde Solo n’est plus acceptée. Démarrez une nouvelle partie.',
        code: 'legacy_session_submission_disabled',
      })
  })

  it('démarre un run avec une configuration validée', async () => {
    await request(testApp()).post('/api/solo-runs').send(validStartPayload()).expect(201, { run })

    expect(soloRunMocks.startSoloRun).toHaveBeenCalledWith('player-1', validStartPayload())
  })

  it('rejette une durée Sprint choisie hors contrat', async () => {
    await request(testApp())
      .post('/api/solo-runs')
      .send({ ...validStartPayload(), mode: 'sprint', sprintDurationSeconds: 15 })
      .expect(400)

    expect(soloRunMocks.startSoloRun).not.toHaveBeenCalled()
  })

  it('ne transmet au service que l’index et la réponse utilisateur', async () => {
    await request(testApp())
      .post('/api/solo-runs/run-1/answers')
      .send({ questionIndex: 0, userAnswer: 3, correctAnswer: 3, bestStreak: 99, responseTimeMs: 1 })
      .expect(200, { run, correction: null })

    expect(soloRunMocks.submitSoloAnswer).toHaveBeenCalledWith('player-1', 'run-1', {
      questionIndex: 0,
      userAnswer: 3,
    })
  })

  it('reprend le run actif et permet sa finalisation', async () => {
    await request(testApp()).get('/api/solo-runs/active').expect(200, { run })
    await request(testApp()).post('/api/solo-runs/run-1/finish').expect(200, {
      run: { ...run, status: 'completed' },
    })

    expect(soloRunMocks.getActiveSoloRun).toHaveBeenCalledWith('player-1')
    expect(soloRunMocks.finishSoloRun).toHaveBeenCalledWith('player-1', 'run-1')
  })
})
