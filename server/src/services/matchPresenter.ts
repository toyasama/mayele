import type { MatchView } from './matchService.js'

export type SerializedPublicPlayer = ReturnType<typeof serializePublicPlayer>
type SerializedMatchBase = ReturnType<typeof serializeMatchBase>
export type SerializedMatch = SerializedMatchBase

type SerializedSessionRewards = {
  missionXpEarned: number
  completedMissions: Array<{ key: string; title: string; rewardXp: number }>
  completedBadges: Array<{ key: string; title: string; familyLabel: string }>
  earnedAchievements: Array<{ key: string; label: string }>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : null
}

export function serializeSessionRewards(value: unknown): SerializedSessionRewards | null {
  if (!isRecord(value)) return null

  const completedMissions = Array.isArray(value.completedMissions)
    ? value.completedMissions.flatMap((mission) => {
        if (!isRecord(mission)) return []
        const key = stringValue(mission.key)
        const title = stringValue(mission.title)
        const rewardXp = typeof mission.rewardXp === 'number' ? mission.rewardXp : null
        return key && title && rewardXp !== null ? [{ key, title, rewardXp }] : []
      })
    : []
  const completedBadges = Array.isArray(value.completedBadges)
    ? value.completedBadges.flatMap((badge) => {
        if (!isRecord(badge)) return []
        const key = stringValue(badge.key)
        const title = stringValue(badge.title)
        const familyLabel = stringValue(badge.familyLabel)
        return key && title && familyLabel ? [{ key, title, familyLabel }] : []
      })
    : []
  const earnedAchievements = Array.isArray(value.earnedAchievements)
    ? value.earnedAchievements.flatMap((achievement) => {
        if (!isRecord(achievement)) return []
        const key = stringValue(achievement.key)
        const label = stringValue(achievement.label)
        return key && label ? [{ key, label }] : []
      })
    : []

  return {
    missionXpEarned: typeof value.missionXpEarned === 'number' ? value.missionXpEarned : 0,
    completedMissions,
    completedBadges,
    earnedAchievements,
  }
}

export function serializePublicPlayer(player: MatchView['participants'][number]['player']) {
  return {
    id: player.id,
    name: player.name,
    username: player.username,
    avatarUrl: player.avatarUrl,
    totalXp: player.totalXp,
    presenceStatus: player.presenceStatus,
    presenceUpdatedAt: player.presenceUpdatedAt.toISOString(),
  }
}

function serializeMatchBase(match: MatchView) {
  const serverNow = new Date()

  return {
    id: match.id,
    roomId: match.roomId,
    type: match.type,
    challengeMode: match.challengeMode,
    status: match.status,
    game: match.game,
    level: match.level,
    practiceSkill: match.practiceSkill,
    durationSeconds: match.durationSeconds,
    questionCount: match.questionCount,
    perQuestionTimeLimitSeconds: match.perQuestionTimeLimitSeconds,
    questionSeed: match.questionSeed,
    configVersion: match.configVersion,
    winnerPlayerId: match.winnerPlayerId,
    createdAt: match.createdAt.toISOString(),
    expiresAt: match.expiresAt.toISOString(),
    endsAt: match.endsAt?.toISOString() ?? null,
    serverNow: serverNow.toISOString(),
    hostActiveAt: match.hostActiveAt?.toISOString() ?? null,
    startedAt: match.startedAt?.toISOString() ?? null,
    tempoQuestionIndex: match.tempoQuestionIndex ?? null,
    tempoQuestionStartedAt: match.tempoQuestionStartedAt?.toISOString() ?? null,
    tempoQuestionDeadlineAt: match.tempoQuestionDeadlineAt?.toISOString() ?? null,
    finishedAt: match.finishedAt?.toISOString() ?? null,
    createdBy: serializePublicPlayer(match.createdBy),
    participants: match.participants.map((participant) => ({
      id: participant.id,
      status: participant.status,
      preferredChallengeMode: participant.preferredChallengeMode,
      preferredGame: participant.preferredGame,
      preferredLevel: participant.preferredLevel,
      score: participant.score,
      scorePoints: participant.scorePoints,
      xp: participant.xp,
      correctAnswers: participant.correctAnswers,
      totalQuestions: participant.totalQuestions,
      totalResponseTimeMs: participant.totalResponseTimeMs,
      bestStreak: participant.bestStreak,
      joinedAt: participant.joinedAt?.toISOString() ?? null,
      finishedAt: participant.finishedAt?.toISOString() ?? null,
      forfeitedAt: participant.forfeitedAt?.toISOString() ?? null,
      rematchRequestedAt: participant.rematchRequestedAt?.toISOString() ?? null,
      resultDismissedAt: participant.resultDismissedAt?.toISOString() ?? null,
      rewards: serializeSessionRewards(participant.session?.submissionResult),
      challengeStats: participant.challengeStats,
      player: serializePublicPlayer(participant.player),
    })),
  }
}

export function serializeMatch(match: MatchView): SerializedMatch {
  return serializeMatchBase(match)
}
