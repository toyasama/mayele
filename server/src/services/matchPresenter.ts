import type { MatchView } from './matchService.js'

export type SerializedPublicPlayer = ReturnType<typeof serializePublicPlayer>
type SerializedMatchBase = ReturnType<typeof serializeMatchBase>
export type SerializedMatch = SerializedMatchBase & {
  tempoQuestionIndex?: number | null
  tempoQuestionStartedAt?: string | null
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
      challengeStats: participant.challengeStats,
      player: serializePublicPlayer(participant.player),
    })),
  }
}

export function serializeMatch(match: MatchView): SerializedMatch {
  return serializeMatchBase(match)
}
