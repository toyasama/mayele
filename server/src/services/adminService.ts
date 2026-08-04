import type { Prisma } from '../generated/prisma/client.js'
import { ApiError } from '../errors.js'
import { prisma } from '../lib/prisma.js'
import { deleteClerkUser } from '../middleware/auth.js'
import { invalidateDashboardCache } from './dashboardService.js'

const ACTIVE_PRESENCE_WINDOW_MS = 5 * 60 * 1_000
const DAY_MS = 24 * 60 * 60 * 1_000

function ageFromBirthDate(birthDate: Date | null, now = new Date()) {
  if (!birthDate) return null

  let age = now.getUTCFullYear() - birthDate.getUTCFullYear()
  const birthdayPassed =
    now.getUTCMonth() > birthDate.getUTCMonth() ||
    (now.getUTCMonth() === birthDate.getUTCMonth() && now.getUTCDate() >= birthDate.getUTCDate())

  if (!birthdayPassed) age -= 1
  return age
}

function confirmationValue(player: { username: string | null; name: string }) {
  return player.username ?? player.name
}

function assertConfirmation(player: { username: string | null; name: string }, confirmation: string) {
  if (confirmation !== confirmationValue(player)) {
    throw new ApiError(400, 'La confirmation ne correspond pas au compte cible.', 'admin_confirmation_mismatch')
  }
}

function isClerkUserAlreadyAbsent(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    (('status' in error && error.status === 404) ||
      ('statusCode' in error && error.statusCode === 404) ||
      ('clerkError' in error && error.clerkError === true && 'errors' in error && Array.isArray(error.errors) &&
        error.errors.some((item) => typeof item === 'object' && item !== null && 'code' in item && item.code === 'resource_not_found')))
  )
}

export async function getAdminOverview(now = new Date()) {
  const oneDayAgo = new Date(now.getTime() - DAY_MS)
  const sevenDaysAgo = new Date(now.getTime() - 7 * DAY_MS)
  const activePresenceCutoff = new Date(now.getTime() - ACTIVE_PRESENCE_WINDOW_MS)

  const [
    registeredUsers,
    completeProfiles,
    newUsersSevenDays,
    activeUsers,
    totalSessions,
    sessionsLastDay,
    matchesLastDay,
    activeSoloRuns,
    outboxBacklog,
    failedOutboxEvents,
    latestSession,
    recentAudit,
  ] = await Promise.all([
    prisma.player.count(),
    prisma.player.count({
      where: {
        firstName: { not: null },
        lastName: { not: null },
        birthDate: { not: null },
        username: { not: null },
      },
    }),
    prisma.player.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
    prisma.player.count({
      where: {
        presenceStatus: { in: ['online', 'away'] },
        presenceUpdatedAt: { gte: activePresenceCutoff },
      },
    }),
    prisma.gameSession.count(),
    prisma.gameSession.count({ where: { playedAt: { gte: oneDayAgo } } }),
    prisma.match.count({ where: { createdAt: { gte: oneDayAgo } } }),
    prisma.soloRun.count({ where: { status: { in: ['active', 'finalizing'] } } }),
    prisma.outboxEvent.count({ where: { status: { in: ['pending', 'processing', 'failed'] } } }),
    prisma.outboxEvent.count({ where: { status: 'failed' } }),
    prisma.gameSession.findFirst({ orderBy: { playedAt: 'desc' }, select: { playedAt: true } }),
    prisma.adminAuditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 12 }),
  ])

  return {
    serverTime: now.toISOString(),
    metrics: {
      registeredUsers,
      completeProfiles,
      newUsersSevenDays,
      activeUsers,
      totalSessions,
      sessionsLastDay,
      matchesLastDay,
      activeSoloRuns,
    },
    operations: {
      database: 'operational' as const,
      outboxBacklog,
      failedOutboxEvents,
      latestActivityAt: latestSession?.playedAt.toISOString() ?? null,
    },
    recentAudit: recentAudit.map((entry) => ({
      id: entry.id,
      actorClerkUserId: entry.actorClerkUserId,
      action: entry.action,
      targetPlayerId: entry.targetPlayerId,
      targetLabel: entry.targetLabel,
      createdAt: entry.createdAt.toISOString(),
    })),
  }
}

export async function listAdminUsers(input: { page: number; pageSize: number; search: string }, now = new Date()) {
  const where: Prisma.PlayerWhereInput = input.search
    ? {
        OR: [
          { username: { contains: input.search, mode: 'insensitive' } },
          { firstName: { contains: input.search, mode: 'insensitive' } },
          { lastName: { contains: input.search, mode: 'insensitive' } },
          { email: { contains: input.search, mode: 'insensitive' } },
        ],
      }
    : {}

  const [total, players] = await Promise.all([
    prisma.player.count({ where }),
    prisma.player.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      select: {
        id: true,
        clerkUserId: true,
        email: true,
        name: true,
        firstName: true,
        lastName: true,
        birthDate: true,
        username: true,
        avatarUrl: true,
        presenceStatus: true,
        presenceUpdatedAt: true,
        totalXp: true,
        createdAt: true,
        _count: { select: { sessions: true } },
      },
    }),
  ])

  return {
    users: players.map((player) => ({
      id: player.id,
      clerkUserId: player.clerkUserId,
      email: player.email,
      name: player.name,
      firstName: player.firstName,
      lastName: player.lastName,
      username: player.username,
      avatarUrl: player.avatarUrl,
      age: ageFromBirthDate(player.birthDate, now),
      presenceStatus: player.presenceStatus,
      presenceUpdatedAt: player.presenceUpdatedAt.toISOString(),
      totalXp: player.totalXp,
      sessionsCount: player._count.sessions,
      createdAt: player.createdAt.toISOString(),
      confirmationValue: confirmationValue(player),
    })),
    pagination: {
      page: input.page,
      pageSize: input.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / input.pageSize)),
    },
  }
}

export async function resetPlayerProgress(actorClerkUserId: string, playerId: string, confirmation: string) {
  const player = await prisma.player.findUnique({
    where: { id: playerId },
    select: { id: true, clerkUserId: true, username: true, name: true },
  })

  if (!player) throw new ApiError(404, 'Compte joueur introuvable.', 'admin_player_not_found')
  if (player.clerkUserId === actorClerkUserId) {
    throw new ApiError(403, 'Vous ne pouvez pas reinitialiser votre propre compte administrateur.', 'admin_self_action_denied')
  }
  assertConfirmation(player, confirmation)

  const result = await prisma.$transaction(async (tx) => {
    const soloRuns = await tx.soloRun.deleteMany({ where: { playerId } })
    const sessions = await tx.gameSession.deleteMany({ where: { playerId } })
    await Promise.all([
      tx.achievement.deleteMany({ where: { playerId } }),
      tx.dailyStat.deleteMany({ where: { playerId } }),
      tx.missionCompletion.deleteMany({ where: { playerId } }),
      tx.xpLedgerEntry.deleteMany({ where: { playerId } }),
    ])
    await tx.player.update({ where: { id: playerId }, data: { totalXp: 0 } })
    await tx.adminAuditLog.create({
      data: {
        actorClerkUserId,
        action: 'player.progress_reset',
        targetPlayerId: player.id,
        targetClerkUserId: player.clerkUserId,
        targetLabel: confirmationValue(player),
        metadata: { deletedSessions: sessions.count, deletedSoloRuns: soloRuns.count },
      },
    })

    return { deletedSessions: sessions.count, deletedSoloRuns: soloRuns.count }
  })

  invalidateDashboardCache(playerId)
  return result
}

export async function deletePlayerAccount(actorClerkUserId: string, playerId: string, confirmation: string) {
  const player = await prisma.player.findUnique({
    where: { id: playerId },
    select: { id: true, clerkUserId: true, username: true, name: true },
  })

  if (!player) throw new ApiError(404, 'Compte joueur introuvable.', 'admin_player_not_found')
  if (player.clerkUserId === actorClerkUserId) {
    throw new ApiError(403, 'Vous ne pouvez pas supprimer votre propre compte administrateur.', 'admin_self_action_denied')
  }
  assertConfirmation(player, confirmation)

  try {
    await deleteClerkUser(player.clerkUserId)
  } catch (error) {
    if (!isClerkUserAlreadyAbsent(error)) throw error
  }

  await prisma.$transaction([
    prisma.player.delete({ where: { id: playerId } }),
    prisma.adminAuditLog.create({
      data: {
        actorClerkUserId,
        action: 'player.account_deleted',
        targetPlayerId: player.id,
        targetClerkUserId: player.clerkUserId,
        targetLabel: confirmationValue(player),
      },
    }),
  ])

  invalidateDashboardCache(playerId)
}
