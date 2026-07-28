import { Router } from 'express'
import { env } from '../config/env.js'
import { VALID_GAMES, type GameLevel, type GameType } from '../domain/constants.js'
import { ApiError } from '../errors.js'
import { prisma } from '../lib/prisma.js'
import { emitMatchSnapshot, resetRealtimeStateForTests } from '../realtime/notifications.js'
import { invalidateDashboardCache } from '../services/dashboardService.js'
import { getMatch } from '../services/matchService.js'
import { serializeMatch } from '../services/matchPresenter.js'

const E2E_PLAYERS = [
  {
    clerkUserId: 'e2e-host',
    email: 'alice.host@example.test',
    firstName: 'Alice',
    lastName: 'Host',
    username: 'alice-host',
    name: 'Alice Host',
  },
  {
    clerkUserId: 'e2e-guest',
    email: 'bob.guest@example.test',
    firstName: 'Bob',
    lastName: 'Guest',
    username: 'bob-guest',
    name: 'Bob Guest',
  },
  {
    clerkUserId: 'e2e-target',
    email: 'charlie.target@example.test',
    firstName: 'Charlie',
    lastName: 'Target',
    username: 'charlie-target',
    name: 'Charlie Target',
  },
] as const

function assertE2EEnabled() {
  if (env.isProduction || !env.e2eAuthBypass) {
    throw new ApiError(404, 'Ressource introuvable.', 'not_found')
  }
}

async function createDemoSession(options: {
  playerId: string
  game: GameType
  level: GameLevel
  correctAnswers: number
  totalQuestions: number
  bestStreak: number
  responseTimeMs: number
  playedAt: Date
}) {
  const score = Math.round((options.correctAnswers / options.totalQuestions) * 100)
  const xp = Math.max(10, options.correctAnswers * 8 + options.bestStreak * 3)

  return prisma.gameSession.create({
    data: {
      playerId: options.playerId,
      game: options.game,
      level: options.level,
      score,
      scorePoints: options.correctAnswers,
      xp,
      correctAnswers: options.correctAnswers,
      totalQuestions: options.totalQuestions,
      durationSeconds: 60,
      bestStreak: options.bestStreak,
      playedAt: options.playedAt,
      answers: {
        create: Array.from({ length: options.totalQuestions }, (_, index) => {
          const isCorrect = index < options.correctAnswers

          return {
            playerId: options.playerId,
            game: options.game,
            level: options.level,
            skill: options.game === 'mixte' ? 'mixte' : options.game,
            prompt: `${index + 1} + ${index + 1}`,
            correctAnswer: (index + 1) * 2,
            userAnswer: isCorrect ? (index + 1) * 2 : (index + 1) * 2 + 1,
            responseTimeMs: options.responseTimeMs,
            isCorrect,
            answeredAt: options.playedAt,
          }
        }),
      },
    },
  })
}

async function createDemoProgress(playerId: string, profile: 'steady' | 'advanced') {
  const now = Date.now()
  const sessions: Array<Promise<unknown>> = []

  VALID_GAMES.forEach((game, gameIndex) => {
    sessions.push(
      createDemoSession({
        playerId,
        game,
        level: 'debutant',
        correctAnswers: 20,
        totalQuestions: 20,
        bestStreak: 20,
        responseTimeMs: profile === 'advanced' ? 950 : 1450,
        playedAt: new Date(now - (gameIndex + 1) * 86_400_000),
      }),
    )
  })

  if (profile === 'advanced') {
    VALID_GAMES.forEach((game, gameIndex) => {
      for (let sessionIndex = 0; sessionIndex < 4; sessionIndex += 1) {
        sessions.push(
          createDemoSession({
            playerId,
            game,
            level: 'debutant',
            correctAnswers: 30,
            totalQuestions: 30,
            bestStreak: 30,
            responseTimeMs: 900,
            playedAt: new Date(now - (gameIndex + 6 + sessionIndex) * 43_200_000),
          }),
        )
      }

      sessions.push(
        createDemoSession({
          playerId,
          game,
          level: 'intermediaire',
          correctAnswers: 12,
          totalQuestions: 14,
          bestStreak: 10,
          responseTimeMs: 1550,
          playedAt: new Date(now - (gameIndex + 18) * 43_200_000),
        }),
      )
    })
  }

  await Promise.all(sessions)
}

export function e2eRoutes() {
  const router = Router()

  router.post('/e2e/reset-multiplayer', async (_req, res, next) => {
    try {
      assertE2EEnabled()
      await resetRealtimeStateForTests()

      const players = await Promise.all(
        E2E_PLAYERS.map((player) =>
          prisma.player.upsert({
            where: { clerkUserId: player.clerkUserId },
            update: {
              email: player.email,
              firstName: player.firstName,
              lastName: player.lastName,
              birthDate: new Date('2000-01-01'),
              username: player.username,
              name: player.name,
              timeZone: 'Europe/Paris',
              presenceStatus: 'offline',
              presenceUpdatedAt: new Date(),
            },
            create: {
              clerkUserId: player.clerkUserId,
              email: player.email,
              firstName: player.firstName,
              lastName: player.lastName,
              birthDate: new Date('2000-01-01'),
              username: player.username,
              name: player.name,
              timeZone: 'Europe/Paris',
              presenceStatus: 'offline',
              presenceUpdatedAt: new Date(),
            },
          }),
        ),
      )

      const [host, guest] = players
      const playerIds = players.map((player) => player.id)
      const socialRequestIds = await prisma.friendRequest.findMany({
        where: {
          OR: [{ senderId: { in: playerIds } }, { receiverId: { in: playerIds } }],
        },
        select: { id: true },
      })
      const socialNotificationIds = await prisma.notification.findMany({
        where: {
          OR: [{ playerId: { in: playerIds } }, { actorPlayerId: { in: playerIds } }],
        },
        select: { id: true },
      })
      const friendshipAggregateIds = playerIds.flatMap((playerId, index) =>
        playerIds.slice(index + 1).map((otherPlayerId) => [playerId, otherPlayerId].sort().join(':')),
      )

      await prisma.$transaction([
        prisma.outboxEvent.deleteMany({
          where: {
            OR: [
              {
                aggregateType: 'friend_request',
                aggregateId: { in: socialRequestIds.map((request) => request.id) },
              },
              {
                aggregateType: 'notification',
                aggregateId: { in: socialNotificationIds.map((notification) => notification.id) },
              },
              {
                aggregateType: 'notification_inbox',
                aggregateId: { in: playerIds },
              },
              {
                aggregateType: 'friendship',
                aggregateId: { in: friendshipAggregateIds },
              },
            ],
          },
        }),
        prisma.notification.deleteMany({
          where: {
            OR: [{ playerId: { in: playerIds } }, { actorPlayerId: { in: playerIds } }],
          },
        }),
        prisma.match.deleteMany({
          where: {
            OR: [{ createdById: { in: playerIds } }, { participants: { some: { playerId: { in: playerIds } } } }],
          },
        }),
        prisma.answer.deleteMany({
          where: { playerId: { in: playerIds } },
        }),
        prisma.xpLedgerEntry.deleteMany({
          where: { playerId: { in: playerIds } },
        }),
        prisma.soloRun.deleteMany({
          where: { playerId: { in: playerIds } },
        }),
        prisma.gameSession.deleteMany({
          where: { playerId: { in: playerIds } },
        }),
        prisma.friendRequest.deleteMany({
          where: {
            OR: [
              { senderId: { in: playerIds } },
              { receiverId: { in: playerIds } },
            ],
          },
        }),
        prisma.friendship.deleteMany({
          where: {
            OR: [
              { playerAId: { in: playerIds } },
              { playerBId: { in: playerIds } },
            ],
          },
        }),
        prisma.friendship.upsert({
          where: {
            playerAId_playerBId: host.id < guest.id
              ? { playerAId: host.id, playerBId: guest.id }
              : { playerAId: guest.id, playerBId: host.id },
          },
          update: {},
          create: host.id < guest.id
            ? { playerAId: host.id, playerBId: guest.id }
            : { playerAId: guest.id, playerBId: host.id },
        }),
      ])

      await Promise.all([createDemoProgress(host.id, 'steady'), createDemoProgress(guest.id, 'advanced')])

      const xpTotals = await prisma.gameSession.groupBy({
        by: ['playerId'],
        where: { playerId: { in: playerIds } },
        _sum: { xp: true },
      })

      await Promise.all(
        players.map((player) =>
          prisma.player.update({
            where: { id: player.id },
            data: {
              totalXp: xpTotals.find((item) => item.playerId === player.id)?._sum.xp ?? 0,
            },
          }),
        ),
      )

      await prisma.xpLedgerEntry.createMany({
        data: players.flatMap((player) => {
          const totalXp = xpTotals.find((item) => item.playerId === player.id)?._sum.xp ?? 0
          return totalXp === 0 ? [] : [{
            playerId: player.id,
            sourceType: 'historical_bootstrap',
            sourceId: 'e2e-reset-balance',
            amount: totalXp,
            metadata: { reason: 'Projection déterministe E2E' },
          }]
        }),
      })

      playerIds.forEach(invalidateDashboardCache)

      res.json({
        players: {
          host: { id: host.id, clerkUserId: host.clerkUserId, username: host.username },
          guest: { id: guest.id, clerkUserId: guest.clerkUserId, username: guest.username },
          target: {
            id: players[2].id,
            clerkUserId: players[2].clerkUserId,
            username: players[2].username,
          },
        },
      })
    } catch (error) {
      next(error)
    }
  })

  router.get('/e2e/outbox/:aggregateId', async (req, res, next) => {
    try {
      assertE2EEnabled()
      const events = await prisma.outboxEvent.findMany({
        where: { aggregateId: req.params.aggregateId },
        orderBy: { createdAt: 'asc' },
        select: { id: true, topic: true, status: true, attempts: true, publishedAt: true },
      })
      res.json({ events })
    } catch (error) {
      next(error)
    }
  })

  router.get('/e2e/player-ledger/:clerkUserId', async (req, res, next) => {
    try {
      assertE2EEnabled()
      const player = await prisma.player.findUniqueOrThrow({
        where: { clerkUserId: req.params.clerkUserId },
        select: {
          totalXp: true,
          xpLedgerEntries: {
            orderBy: { createdAt: 'asc' },
            select: { sourceType: true, sourceId: true, amount: true },
          },
        },
      })
      res.json(player)
    } catch (error) {
      next(error)
    }
  })

  router.post('/e2e/completed-match', async (_req, res, next) => {
    try {
      assertE2EEnabled()

      const [host, guest] = await Promise.all([
        prisma.player.findUnique({ where: { clerkUserId: 'e2e-host' } }),
        prisma.player.findUnique({ where: { clerkUserId: 'e2e-guest' } }),
      ])

      if (!host || !guest) {
        throw new ApiError(409, 'Joueurs E2E indisponibles.', 'e2e_players_missing')
      }

      const now = new Date()
      const startedAt = new Date(now.getTime() - 30_000)
      const finishedAt = new Date(now.getTime() - 1_000)
      const expiresAt = new Date(now.getTime() + 120_000)

      const created = await prisma.match.create({
        data: {
          type: 'challenge',
          challengeMode: 'tempo',
          status: 'completed',
          game: 'addition',
          level: 'debutant',
          practiceSkill: null,
          durationSeconds: 60,
          questionCount: 10,
          perQuestionTimeLimitSeconds: 10,
          questionSeed: 'e2e-completed-match',
          configVersion: 3,
          createdById: host.id,
          winnerPlayerId: host.id,
          roomId: null,
          expiresAt,
          hostActiveAt: startedAt,
          startedAt,
          finishedAt,
          participants: {
            create: [
              {
                playerId: host.id,
                status: 'completed',
                score: 100,
                scorePoints: 10,
                xp: 95,
                correctAnswers: 10,
                totalQuestions: 10,
                totalResponseTimeMs: 8_000,
                bestStreak: 10,
                joinedAt: startedAt,
                finishedAt,
              },
              {
                playerId: guest.id,
                status: 'completed',
                score: 80,
                scorePoints: 8,
                xp: 75,
                correctAnswers: 8,
                totalQuestions: 10,
                totalResponseTimeMs: 10_000,
                bestStreak: 4,
                joinedAt: startedAt,
                finishedAt,
              },
            ],
          },
        },
      })
      const match = await getMatch(host.id, created.id)

      emitMatchSnapshot(match, 'match_completed')
      res.status(201).json({ match: serializeMatch(match) })
    } catch (error) {
      next(error)
    }
  })

  return router
}
