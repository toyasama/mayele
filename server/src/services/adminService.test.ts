import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../errors.js'

const txMocks = vi.hoisted(() => ({
  achievement: { deleteMany: vi.fn() },
  adminAuditLog: { create: vi.fn() },
  dailyStat: { deleteMany: vi.fn() },
  dailyMissionAssignment: { deleteMany: vi.fn() },
  gameSession: { deleteMany: vi.fn() },
  missionCompletion: { deleteMany: vi.fn() },
  player: { update: vi.fn() },
  soloRun: { deleteMany: vi.fn() },
  xpLedgerEntry: { deleteMany: vi.fn() },
}))
const prismaMocks = vi.hoisted(() => ({
  $transaction: vi.fn(),
  adminAuditLog: { create: vi.fn() },
  player: { delete: vi.fn(), findUnique: vi.fn() },
}))
const authMocks = vi.hoisted(() => ({ deleteClerkUser: vi.fn() }))
const dashboardMocks = vi.hoisted(() => ({ invalidateDashboardCache: vi.fn() }))

vi.mock('../lib/prisma.js', () => ({ prisma: prismaMocks }))
vi.mock('../middleware/auth.js', () => ({ deleteClerkUser: authMocks.deleteClerkUser }))
vi.mock('./dashboardService.js', () => ({ invalidateDashboardCache: dashboardMocks.invalidateDashboardCache }))

const { deletePlayerAccount, resetPlayerProgress } = await import('./adminService.js')

const targetPlayer = {
  id: 'player-1',
  clerkUserId: 'user_target123',
  username: 'ada',
  name: 'Ada Lovelace',
}

describe('admin service destructive actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMocks.player.findUnique.mockResolvedValue(targetPlayer)
    prismaMocks.player.delete.mockResolvedValue(targetPlayer)
    prismaMocks.adminAuditLog.create.mockResolvedValue({ id: 'audit-1' })
    prismaMocks.$transaction.mockImplementation(async (input: unknown) => {
      if (typeof input === 'function') return input(txMocks)
      return Promise.all(input as Promise<unknown>[])
    })
    txMocks.soloRun.deleteMany.mockResolvedValue({ count: 1 })
    txMocks.gameSession.deleteMany.mockResolvedValue({ count: 3 })
    txMocks.achievement.deleteMany.mockResolvedValue({ count: 2 })
    txMocks.dailyStat.deleteMany.mockResolvedValue({ count: 2 })
    txMocks.missionCompletion.deleteMany.mockResolvedValue({ count: 2 })
    txMocks.xpLedgerEntry.deleteMany.mockResolvedValue({ count: 4 })
    txMocks.player.update.mockResolvedValue({ ...targetPlayer, totalXp: 0 })
    txMocks.adminAuditLog.create.mockResolvedValue({ id: 'audit-1' })
    authMocks.deleteClerkUser.mockResolvedValue({ id: targetPlayer.clerkUserId })
  })

  it('refuse une confirmation qui ne correspond pas exactement au pseudo', async () => {
    await expect(resetPlayerProgress('user_admin123', targetPlayer.id, 'ADA')).rejects.toMatchObject({
      statusCode: 400,
      code: 'admin_confirmation_mismatch',
    } satisfies Partial<ApiError>)

    expect(prismaMocks.$transaction).not.toHaveBeenCalled()
  })

  it('interdit a l administrateur d agir sur son propre compte', async () => {
    prismaMocks.player.findUnique.mockResolvedValue({ ...targetPlayer, clerkUserId: 'user_admin123' })

    await expect(deletePlayerAccount('user_admin123', targetPlayer.id, 'ada')).rejects.toMatchObject({
      statusCode: 403,
      code: 'admin_self_action_denied',
    } satisfies Partial<ApiError>)

    expect(authMocks.deleteClerkUser).not.toHaveBeenCalled()
  })

  it('reinitialise les donnees de progression et ecrit le journal dans la transaction', async () => {
    await expect(resetPlayerProgress('user_admin123', targetPlayer.id, 'ada')).resolves.toEqual({
      deletedSessions: 3,
      deletedSoloRuns: 1,
    })

    expect(txMocks.soloRun.deleteMany).toHaveBeenCalledWith({ where: { playerId: targetPlayer.id } })
    expect(txMocks.gameSession.deleteMany).toHaveBeenCalledWith({ where: { playerId: targetPlayer.id } })
    expect(txMocks.player.update).toHaveBeenCalledWith({ where: { id: targetPlayer.id }, data: { totalXp: 0 } })
    expect(txMocks.adminAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorClerkUserId: 'user_admin123',
        action: 'player.progress_reset',
        targetPlayerId: targetPlayer.id,
      }),
    })
    expect(dashboardMocks.invalidateDashboardCache).toHaveBeenCalledWith(targetPlayer.id)
  })

  it('supprime d abord l identite Clerk, puis les donnees et conserve une trace', async () => {
    await expect(deletePlayerAccount('user_admin123', targetPlayer.id, 'ada')).resolves.toBeUndefined()

    expect(authMocks.deleteClerkUser).toHaveBeenCalledWith(targetPlayer.clerkUserId)
    expect(prismaMocks.player.delete).toHaveBeenCalledWith({ where: { id: targetPlayer.id } })
    expect(prismaMocks.adminAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'player.account_deleted',
        targetClerkUserId: targetPlayer.clerkUserId,
      }),
    })
    expect(prismaMocks.$transaction).toHaveBeenCalledWith(expect.any(Array))
  })

  it('ne touche pas la base si la suppression Clerk echoue', async () => {
    authMocks.deleteClerkUser.mockRejectedValueOnce(new Error('Clerk indisponible'))

    await expect(deletePlayerAccount('user_admin123', targetPlayer.id, 'ada')).rejects.toThrow('Clerk indisponible')
    expect(prismaMocks.player.delete).not.toHaveBeenCalled()
    expect(prismaMocks.$transaction).not.toHaveBeenCalled()
  })
})
