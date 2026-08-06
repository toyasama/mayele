import { describe, expect, it, vi } from 'vitest'
import { selectDailyMissions } from '../domain/dailyMissions.js'

const prismaMock = {
  $transaction: vi.fn(),
}

vi.mock('../lib/prisma.js', () => ({ prisma: prismaMock }))

const { loadDailyMissionStates } = await import('./dailyMissionService.js')

function createTransactionMock(initialAssignments: Array<Record<string, unknown>> = []) {
  const assignments = [...initialAssignments]
  const tx = {
    $queryRaw: vi.fn(async () => [{ acquired: '1' }]),
    dailyMissionAssignment: {
      findMany: vi.fn(async () => assignments),
      createMany: vi.fn(async (input: { data: Array<Record<string, unknown>> }) => {
        input.data.forEach((item, index) => assignments.push({
          id: `assignment-${assignments.length + index}`,
          createdAt: new Date('2026-08-06T08:00:00.000Z'),
          ...item,
        }))
        return { count: input.data.length }
      }),
    },
    gameSession: {
      findMany: vi.fn(async () => []),
    },
    missionCompletion: {
      findMany: vi.fn(async () => []),
    },
  }

  return { tx, assignments }
}

describe('dailyMissionService', () => {
  it('persists one immutable assignment snapshot per tier under a daily advisory lock', async () => {
    const { tx, assignments } = createTransactionMock()
    const states = await loadDailyMissionStates(tx as never, 'player-1', '2026-08-06')

    expect(tx.$queryRaw).toHaveBeenCalledOnce()
    expect(tx.dailyMissionAssignment.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ playerId: 'player-1', day: '2026-08-06', tier: 'easy', catalogVersion: 2 }),
        expect.objectContaining({ playerId: 'player-1', day: '2026-08-06', tier: 'medium', catalogVersion: 2 }),
        expect.objectContaining({ playerId: 'player-1', day: '2026-08-06', tier: 'hard', catalogVersion: 2 }),
      ]),
      skipDuplicates: true,
    })
    expect(assignments).toHaveLength(3)
    expect(states.map((state) => state.tier)).toEqual(['easy', 'medium', 'hard'])
  })

  it('reads the stored definition snapshot instead of regenerating the current catalog entry', async () => {
    const selected = selectDailyMissions('player-1', '2026-08-06')
    const assignments = selected.map((definition, index) => ({
      id: `assignment-${index}`,
      playerId: 'player-1',
      day: '2026-08-06',
      tier: definition.tier,
      missionKey: definition.key,
      catalogVersion: index === 0 ? 1 : 2,
      definition: index === 0 ? { ...definition, version: 1, title: 'Titre figé au premier affichage' } : definition,
      createdAt: new Date('2026-08-06T08:00:00.000Z'),
    }))
    const { tx } = createTransactionMock(assignments)

    const states = await loadDailyMissionStates(tx as never, 'player-1', '2026-08-06')

    expect(tx.dailyMissionAssignment.createMany).not.toHaveBeenCalled()
    expect(states[0].title).toBe('Titre figé au premier affichage')
  })
})
