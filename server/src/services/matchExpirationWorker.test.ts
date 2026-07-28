import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  $transaction: vi.fn(),
  jobLease: { deleteMany: vi.fn() },
}))
const effectMocks = vi.hoisted(() => ({ persistMatchExpiredEffects: vi.fn() }))
const dispatcherMocks = vi.hoisted(() => ({ requestOutboxDispatch: vi.fn() }))

vi.mock('../lib/prisma.js', () => ({ prisma: prismaMock }))
vi.mock('./matchOutboxEffects.js', () => effectMocks)
vi.mock('./outboxDispatcher.js', () => dispatcherMocks)
vi.mock('../lib/logger.js', () => ({ logger: { error: vi.fn() } }))

const {
  acquireMatchExpirationLease,
  expirePersistedMatches,
  runMatchExpirationSweep,
} = await import('./matchExpirationWorker.js')

const expiredMatch = {
  id: 'match_1',
  roomId: 'room_1',
  type: 'challenge',
  challengeMode: 'sprint',
  status: 'expired',
  game: 'addition',
  level: 'debutant',
  practiceSkill: null,
  durationSeconds: 60,
  questionCount: null,
  perQuestionTimeLimitSeconds: null,
  questionSeed: 'seed_1',
  configVersion: 1,
  winnerPlayerId: null,
  createdAt: new Date('2026-07-19T08:00:00.000Z'),
  expiresAt: new Date('2026-07-19T08:20:00.000Z'),
  hostActiveAt: null,
  startedAt: null,
  finishedAt: new Date('2026-07-19T08:20:00.000Z'),
  createdBy: {
    id: 'player_a', name: 'Awa', username: 'awa', avatarUrl: null,
    totalXp: 1, presenceStatus: 'offline', presenceUpdatedAt: new Date('2026-07-19T08:00:00.000Z'),
  },
  participants: [],
}

describe('matchExpirationWorker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.jobLease.deleteMany.mockResolvedValue({ count: 1 })
  })

  it('ne laisse qu un proprietaire acquerir le bail PostgreSQL', async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([{ job_key: 'match-expiration' }]).mockResolvedValueOnce([])

    await expect(acquireMatchExpirationLease('worker-a')).resolves.toBe(true)
    await expect(acquireMatchExpirationLease('worker-b')).resolves.toBe(false)
  })

  it('expire les matchs et persiste les effets dans la meme transaction', async () => {
    const tx = {
      match: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findMany: vi.fn()
          .mockResolvedValueOnce([{ id: 'match_1' }])
          .mockResolvedValueOnce([expiredMatch]),
      },
    }
    prismaMock.$transaction.mockImplementation((callback: (database: typeof tx) => unknown) => callback(tx))

    await expect(expirePersistedMatches(new Date('2026-07-19T08:20:00.000Z'))).resolves.toBe(1)
    expect(effectMocks.persistMatchExpiredEffects).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ id: 'match_1', status: 'expired' }),
    )
  })

  it('rend toujours le bail apres une erreur afin qu un autre worker puisse reprendre', async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([{ job_key: 'match-expiration' }])
    prismaMock.$transaction.mockRejectedValueOnce(new Error('database unavailable'))

    await expect(runMatchExpirationSweep('worker-a')).rejects.toThrow('database unavailable')
    expect(prismaMock.jobLease.deleteMany).toHaveBeenCalledWith({
      where: { key: 'match-expiration', ownerId: 'worker-a' },
    })
  })

  it('ne lance aucun traitement quand un autre processus detient le bail', async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([])

    await expect(runMatchExpirationSweep('worker-b')).resolves.toEqual({ acquired: false, expiredMatches: 0 })
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
    expect(prismaMock.jobLease.deleteMany).not.toHaveBeenCalled()
  })
})
