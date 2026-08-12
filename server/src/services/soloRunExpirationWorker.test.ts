import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../errors.js'

const prismaMock = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  jobLease: { deleteMany: vi.fn() },
  soloRun: { findMany: vi.fn() },
}))
const soloRunServiceMocks = vi.hoisted(() => ({ finishSoloRun: vi.fn() }))
const loggerMocks = vi.hoisted(() => ({ error: vi.fn() }))

vi.mock('../lib/prisma.js', () => ({ prisma: prismaMock }))
vi.mock('./soloRunService.js', () => soloRunServiceMocks)
vi.mock('../lib/logger.js', () => ({ logger: loggerMocks }))

const {
  acquireSoloRunExpirationLease,
  finalizeExpiredSoloRuns,
  runSoloRunExpirationSweep,
} = await import('./soloRunExpirationWorker.js')

describe('soloRunExpirationWorker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.jobLease.deleteMany.mockResolvedValue({ count: 1 })
    prismaMock.soloRun.findMany.mockResolvedValue([])
    soloRunServiceMocks.finishSoloRun.mockResolvedValue({ status: 'completed' })
  })

  it('ne laisse qu une instance acquerir le bail PostgreSQL', async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([{ job_key: 'solo-run-expiration' }]).mockResolvedValueOnce([])

    await expect(acquireSoloRunExpirationLease('worker-a')).resolves.toBe(true)
    await expect(acquireSoloRunExpirationLease('worker-b')).resolves.toBe(false)
  })

  it('finalise par petits lots les runs dont la duree de jeu est terminee', async () => {
    const now = new Date('2026-08-12T09:00:00.000Z')
    prismaMock.soloRun.findMany.mockResolvedValue([
      { id: 'run-1', playerId: 'player-1' },
      { id: 'run-2', playerId: 'player-2' },
    ])

    await expect(finalizeExpiredSoloRuns(now, 25)).resolves.toEqual({
      candidates: 2,
      completed: 2,
      skipped: 0,
    })
    expect(prismaMock.soloRun.findMany).toHaveBeenCalledWith({
      where: { status: 'active', endsAt: { lte: now } },
      orderBy: { endsAt: 'asc' },
      take: 25,
      select: { id: true, playerId: true },
    })
    expect(soloRunServiceMocks.finishSoloRun).toHaveBeenNthCalledWith(1, 'player-1', 'run-1')
    expect(soloRunServiceMocks.finishSoloRun).toHaveBeenNthCalledWith(2, 'player-2', 'run-2')
  })

  it('ignore une fermeture concurrente deja arbitree par PostgreSQL', async () => {
    prismaMock.soloRun.findMany.mockResolvedValue([{ id: 'run-1', playerId: 'player-1' }])
    soloRunServiceMocks.finishSoloRun.mockRejectedValue(
      new ApiError(409, 'Cette partie Solo n est plus active.', 'solo_run_closed'),
    )

    await expect(finalizeExpiredSoloRuns()).resolves.toEqual({
      candidates: 1,
      completed: 0,
      skipped: 1,
    })
    expect(loggerMocks.error).not.toHaveBeenCalled()
  })

  it('rend le bail apres une erreur afin qu une autre instance puisse reprendre', async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ job_key: 'solo-run-expiration' }])
    prismaMock.soloRun.findMany.mockResolvedValue([{ id: 'run-1', playerId: 'player-1' }])
    soloRunServiceMocks.finishSoloRun.mockRejectedValue(new Error('database unavailable'))

    await expect(runSoloRunExpirationSweep('worker-a')).rejects.toThrow(
      'Impossible de finaliser 1 run(s) Solo expire(s).',
    )
    expect(prismaMock.jobLease.deleteMany).toHaveBeenCalledWith({
      where: { key: 'solo-run-expiration', ownerId: 'worker-a' },
    })
  })

  it('ne traite rien quand une autre instance detient le bail', async () => {
    prismaMock.$queryRaw.mockResolvedValue([])

    await expect(runSoloRunExpirationSweep('worker-b')).resolves.toEqual({
      acquired: false,
      candidates: 0,
      completed: 0,
      skipped: 0,
    })
    expect(prismaMock.soloRun.findMany).not.toHaveBeenCalled()
    expect(prismaMock.jobLease.deleteMany).not.toHaveBeenCalled()
  })
})
