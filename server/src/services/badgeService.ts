import type { Prisma } from '../generated/prisma/client.js'
import { buildBadgeStates } from '../domain/rewards.js'
import { prisma } from '../lib/prisma.js'

// First production deployment that replaced direct /sessions submissions with
// authoritative SoloRun records. No unlinked GameSession exists after this
// cutover in production.
export const LEGACY_SOLO_RUN_CUTOVER_AT = new Date('2026-07-29T10:25:53.702Z')
export const BADGE_SPRINT_DURATION_SECONDS = [60, 90, 120] as const

const COMPLETED_SOLO_SPRINT_SCOPES = BADGE_SPRINT_DURATION_SECONDS.map((durationSeconds) => ({
  durationSeconds,
  matchParticipant: { is: null },
  soloRun: {
    is: {
      mode: 'sprint',
      status: 'completed',
      durationSeconds,
    },
  },
})) satisfies Prisma.GameSessionWhereInput[]

// Badge progression is intentionally Solo Sprint only:
// - modern sessions must be attached to a completed Sprint SoloRun;
// - historical sessions are accepted only when they predate the SoloRun
//   cutover, have no multiplayer provenance, and have a complete legacy Sprint
//   duration. The legacy schema did not persist the Sprint/Tempo mode, so the
//   canonical Sprint durations are the strongest recoverable evidence.
// Multiplayer and Tempo sessions never enter this scope.
export const BADGE_SOLO_SPRINT_SCOPE = {
  OR: [
    ...COMPLETED_SOLO_SPRINT_SCOPES,
    {
      playedAt: { lt: LEGACY_SOLO_RUN_CUTOVER_AT },
      durationSeconds: { in: [...BADGE_SPRINT_DURATION_SECONDS] },
      totalQuestions: { gt: 0 },
      soloRun: { is: null },
      matchParticipant: { is: null },
      answers: { some: {} },
    },
  ],
} satisfies Prisma.GameSessionWhereInput

function countByGameLevel(groups: Array<{ game: string; level: string; _count: { _all: number } }>) {
  return new Map(groups.map((group) => [`${group.level}:${group.game}`, group._count._all]))
}

export async function getPlayerBadgeStates(playerId: string) {
  const sprintSessionWhere = {
    playerId,
    ...BADGE_SOLO_SPRINT_SCOPE,
  } satisfies Prisma.GameSessionWhereInput

  const sprintAnswerWhere = {
    playerId,
    session: { is: BADGE_SOLO_SPRINT_SCOPE },
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
        durationSeconds: true,
        soloRun: {
          select: { durationSeconds: true },
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
      durationSeconds: session.soloRun?.durationSeconds ?? session.durationSeconds,
    })),
  )
}
