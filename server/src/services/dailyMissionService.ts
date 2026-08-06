import {
  DAILY_MISSION_CATALOG_VERSION,
  MISSION_TIERS,
  buildMissionStates,
  missionDefinitionFromSnapshot,
  selectDailyMissions,
  type MissionDefinition,
} from '../domain/dailyMissions.js'
import type { Prisma } from '../generated/prisma/client.js'
import { prisma } from '../lib/prisma.js'

function dailyMissionLockKey(playerId: string, day: string) {
  return `daily-missions:${playerId}:${day}`
}

function tierOrder(tier: string) {
  const index = MISSION_TIERS.indexOf(tier as (typeof MISSION_TIERS)[number])
  return index === -1 ? MISSION_TIERS.length : index
}

async function ensureDailyMissionAssignments(
  tx: Prisma.TransactionClient,
  playerId: string,
  day: string,
) {
  await tx.$queryRaw`
    SELECT pg_advisory_xact_lock(hashtextextended(${dailyMissionLockKey(playerId, day)}, 0))::text AS acquired
  `

  let assignments = await tx.dailyMissionAssignment.findMany({
    where: { playerId, day },
    orderBy: { createdAt: 'asc' },
  })

  if (assignments.length < MISSION_TIERS.length) {
    const selected = selectDailyMissions(playerId, day)
    const assignedTiers = new Set(assignments.map((assignment) => assignment.tier))
    const missing = selected.filter((mission) => !assignedTiers.has(mission.tier))

    if (missing.length) {
      await tx.dailyMissionAssignment.createMany({
        data: missing.map((mission) => ({
          playerId,
          day,
          tier: mission.tier,
          missionKey: mission.key,
          catalogVersion: DAILY_MISSION_CATALOG_VERSION,
          definition: mission as unknown as Prisma.InputJsonValue,
        })),
        skipDuplicates: true,
      })
    }

    assignments = await tx.dailyMissionAssignment.findMany({
      where: { playerId, day },
      orderBy: { createdAt: 'asc' },
    })
  }

  const definitions = assignments
    .map((assignment) => missionDefinitionFromSnapshot(assignment.definition, assignment.missionKey))
    .filter((definition): definition is MissionDefinition => Boolean(definition))
    .sort((left, right) => tierOrder(left.tier) - tierOrder(right.tier))

  if (definitions.length !== MISSION_TIERS.length) {
    throw new Error(`Affectations quotidiennes incomplètes pour ${playerId}:${day}.`)
  }

  return definitions
}

export async function loadDailyMissionStates(
  tx: Prisma.TransactionClient,
  playerId: string,
  day: string,
) {
  const definitions = await ensureDailyMissionAssignments(tx, playerId, day)
  const [sessions, completions] = await Promise.all([
    tx.gameSession.findMany({
      where: {
        playerId,
        missionDay: day,
        missionEligible: true,
      },
      select: {
        id: true,
        playContext: true,
        challengeMode: true,
        game: true,
        level: true,
        configuredDurationSeconds: true,
        configuredQuestionCount: true,
        configuredQuestionSeconds: true,
        validAnswers: true,
        correctAnswers: true,
        totalQuestions: true,
        bestStreak: true,
      },
    }),
    tx.missionCompletion.findMany({
      where: { playerId, scopeKey: day },
      select: {
        missionKey: true,
        scopeKey: true,
        completedAt: true,
        xpAwarded: true,
      },
    }),
  ])

  return buildMissionStates(definitions, sessions, completions, day)
}

export async function getDailyMissionStates(playerId: string, day: string) {
  return prisma.$transaction((tx) => loadDailyMissionStates(tx, playerId, day))
}
