import type { Prisma } from '../generated/prisma/client.js'
import { buildBadgeStates } from '../domain/rewards.js'
import { prisma } from '../lib/prisma.js'

const SPRINT_SESSION_SCOPE = {
  OR: [
    {
      soloRun: {
        is: {
          mode: 'sprint',
          status: 'completed',
        },
      },
    },
    {
      matchParticipant: {
        is: {
          status: 'completed',
          forfeitedAt: null,
          match: {
            is: {
              challengeMode: 'sprint',
              status: 'completed',
            },
          },
        },
      },
    },
  ],
} satisfies Prisma.GameSessionWhereInput

function countByGameLevel(groups: Array<{ game: string; level: string; _count: { _all: number } }>) {
  return new Map(groups.map((group) => [`${group.level}:${group.game}`, group._count._all]))
}

export async function getPlayerBadgeStates(playerId: string) {
  const sprintSessionWhere = {
    playerId,
    ...SPRINT_SESSION_SCOPE,
  } satisfies Prisma.GameSessionWhereInput

  const sprintAnswerWhere = {
    playerId,
    session: { is: SPRINT_SESSION_SCOPE },
  } satisfies Prisma.AnswerWhereInput

  const [progressGroups, masterySessions, fastCorrect2500Groups, fastCorrect1800Groups, fastCorrect1200Groups] = await Promise.all([
    prisma.gameSession.groupBy({
      by: ['game', 'level'],
      where: sprintSessionWhere,
      _count: { _all: true },
      _max: { bestStreak: true },
    }),
    prisma.gameSession.findMany({
      where: sprintSessionWhere,
      select: {
        game: true,
        level: true,
        correctAnswers: true,
        totalQuestions: true,
        soloRun: {
          select: { durationSeconds: true },
        },
        matchParticipant: {
          select: {
            match: {
              select: { durationSeconds: true },
            },
          },
        },
      },
    }),
    prisma.answer.groupBy({
      by: ['game', 'level'],
      where: {
        ...sprintAnswerWhere,
        isCorrect: true,
        responseTimeMs: { lte: 2500 },
      },
      _count: { _all: true },
    }),
    prisma.answer.groupBy({
      by: ['game', 'level'],
      where: {
        ...sprintAnswerWhere,
        isCorrect: true,
        responseTimeMs: { lte: 1800 },
      },
      _count: { _all: true },
    }),
    prisma.answer.groupBy({
      by: ['game', 'level'],
      where: {
        ...sprintAnswerWhere,
        isCorrect: true,
        responseTimeMs: { lte: 1200 },
      },
      _count: { _all: true },
    }),
  ])

  const fastCorrect2500ByMode = countByGameLevel(fastCorrect2500Groups)
  const fastCorrect1800ByMode = countByGameLevel(fastCorrect1800Groups)
  const fastCorrect1200ByMode = countByGameLevel(fastCorrect1200Groups)

  return buildBadgeStates(
    progressGroups.map((item) => ({
      game: item.game,
      level: item.level,
      attempts: item._count._all,
      bestStreak: item._max.bestStreak ?? 0,
      fastCorrectAnswers2500: fastCorrect2500ByMode.get(`${item.level}:${item.game}`) ?? 0,
      fastCorrectAnswers1800: fastCorrect1800ByMode.get(`${item.level}:${item.game}`) ?? 0,
      fastCorrectAnswers1200: fastCorrect1200ByMode.get(`${item.level}:${item.game}`) ?? 0,
    })),
    masterySessions.map((session) => ({
      game: session.game,
      level: session.level,
      correctAnswers: session.correctAnswers,
      totalQuestions: session.totalQuestions,
      durationSeconds: session.soloRun?.durationSeconds ?? session.matchParticipant?.match.durationSeconds ?? 0,
    })),
  )
}
