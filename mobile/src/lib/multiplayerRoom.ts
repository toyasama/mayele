import type { GameLevel, GameMode, GameType, MatchData } from './api';
import type { MultiplayerConfigPayload } from './multiplayerRealtime';

export type MultiplayerRoomConfig = {
  mode: GameMode;
  game: GameType;
  level: GameLevel;
  duration: 60 | 90 | 120;
  questionCount: number;
  questionSeconds: number;
};

const ACTIVE_STATUSES = new Set(['pending', 'accepted', 'ready', 'in_progress']);

export function matchStatusRank(status: string) {
  if (status === 'in_progress') return 4;
  if (status === 'completed' || status === 'cancelled' || status === 'expired') return 5;
  if (status === 'ready') return 3;
  if (status === 'accepted') return 2;
  if (status === 'pending') return 1;
  return 0;
}

export function isOlderMatchSnapshot(current: MatchData | null | undefined, next: MatchData) {
  if (!current || current.id !== next.id) return false;
  if (current.status === 'ready' && next.status === 'accepted' && next.configVersion > current.configVersion) return false;
  if (matchStatusRank(next.status) < matchStatusRank(current.status)) return true;
  if (next.configVersion < current.configVersion) return true;
  return Boolean(
    current.status === 'in_progress'
    && next.status === 'in_progress'
    && current.challengeMode === 'tempo'
    && next.challengeMode === 'tempo'
    && typeof current.tempoQuestionIndex === 'number'
    && typeof next.tempoQuestionIndex === 'number'
    && next.tempoQuestionIndex < current.tempoQuestionIndex,
  );
}

export function mergeMonotonicMatch(current: MatchData | null | undefined, next: MatchData) {
  if (!current || current.id !== next.id) return next;
  const participants = new Map(current.participants.map((participant) => [participant.id, participant]));
  const keepTempo = current.status === 'in_progress'
    && next.status === 'in_progress'
    && current.challengeMode === 'tempo'
    && next.challengeMode === 'tempo'
    && typeof current.tempoQuestionIndex === 'number'
    && (typeof next.tempoQuestionIndex !== 'number' || next.tempoQuestionIndex < current.tempoQuestionIndex);
  return {
    ...next,
    tempoQuestionIndex: keepTempo ? current.tempoQuestionIndex : next.tempoQuestionIndex,
    tempoQuestionStartedAt: keepTempo ? current.tempoQuestionStartedAt : next.tempoQuestionStartedAt,
    participants: next.participants.map((participant) => {
      const previous = participants.get(participant.id);
      return previous ? {
        ...participant,
        rematchRequestedAt: participant.rematchRequestedAt ?? previous.rematchRequestedAt,
        resultDismissedAt: participant.resultDismissedAt ?? previous.resultDismissedAt,
        forfeitedAt: participant.forfeitedAt ?? previous.forfeitedAt,
      } : participant;
    }),
  };
}

export function participantFor(match: MatchData, playerId: string | undefined) {
  return playerId ? match.participants.find((participant) => participant.player.id === playerId) ?? null : null;
}

export function opponentFor(match: MatchData | null, playerId: string | undefined) {
  return match?.participants.find((participant) => participant.player.id !== playerId) ?? null;
}

export function isParticipantInRoom(status: string | undefined) {
  return status === 'accepted' || status === 'ready' || status === 'playing' || status === 'submitting' || status === 'completed';
}

export function isActiveRoomMatch(match: MatchData, playerId: string | undefined, nowMs = Date.now()) {
  const participant = participantFor(match, playerId);
  return Boolean(
    participant
    && ACTIVE_STATUSES.has(match.status)
    && new Date(match.expiresAt).getTime() > nowMs
    && participant.status !== 'declined'
    && participant.status !== 'disconnected',
  );
}

export function isVisibleCompletedResult(match: MatchData, playerId: string | undefined, nowMs = Date.now()) {
  const participant = participantFor(match, playerId);
  return Boolean(
    participant
    && match.status === 'completed'
    && !participant.resultDismissedAt
    && new Date(match.expiresAt).getTime() > nowMs,
  );
}

function roomSelectionRank(match: MatchData, playerId: string | undefined) {
  if (match.status === 'in_progress') return 500;
  if (match.status === 'ready') return 400;
  if (match.status === 'accepted') return 300;
  if (match.status === 'pending' && match.createdBy?.id !== playerId) return 250;
  if (match.status === 'pending') return 200;
  if (match.status === 'completed') return 100;
  return 0;
}

export function selectActiveRoomMatch(matches: MatchData[], playerId: string | undefined, nowMs = Date.now()) {
  return [...matches]
    .filter((match) => isActiveRoomMatch(match, playerId, nowMs) || isVisibleCompletedResult(match, playerId, nowMs))
    .sort((left, right) => roomSelectionRank(right, playerId) - roomSelectionRank(left, playerId) || new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())[0] ?? null;
}

export function configFromMatch(match: MatchData): MultiplayerRoomConfig {
  const duration = [60, 90, 120].includes(match.durationSeconds) ? match.durationSeconds as 60 | 90 | 120 : 60;
  return {
    mode: match.challengeMode === 'tempo' ? 'tempo' : 'sprint',
    game: match.game ?? 'addition',
    level: match.level ?? 'debutant',
    duration,
    questionCount: match.questionCount ?? 30,
    questionSeconds: match.perQuestionTimeLimitSeconds ?? 10,
  };
}

export function configPayload(config: MultiplayerRoomConfig, expectedConfigVersion?: number): MultiplayerConfigPayload {
  return {
    challengeMode: config.mode,
    game: config.game,
    level: config.level,
    practiceSkill: null,
    ...(config.mode === 'sprint'
      ? { durationSeconds: config.duration }
      : { questionCount: config.questionCount, perQuestionTimeLimitSeconds: config.questionSeconds }),
    ...(expectedConfigVersion === undefined ? {} : { expectedConfigVersion }),
  };
}
