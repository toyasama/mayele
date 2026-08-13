import type { MatchData } from './api';
import type { MatchQuestion } from './matchQuestions';
import type { MultiplayerAnswerPayload, MultiplayerProgressPayload, MultiplayerResultPayload } from './multiplayerRealtime';

export type LocalMultiplayerAnswer = MultiplayerAnswerPayload & { isCorrect: boolean };

const SCORE_BASE = { debutant: 8, intermediaire: 10, avance: 13, expert: 16 } as const;
const SPEED_REFERENCE_MS = { debutant: 6_000, intermediaire: 8_000, avance: 10_000, expert: 12_000 } as const;

export function computeBestStreak(answers: LocalMultiplayerAnswer[]) {
  let current = 0;
  let best = 0;
  for (const answer of answers) {
    current = answer.isCorrect ? current + 1 : 0;
    best = Math.max(best, current);
  }
  return best;
}

export function computeScorePoints(level: MatchData['level'], answers: LocalMultiplayerAnswer[]) {
  if (!level) return 0;
  return answers.reduce((total, answer) => {
    if (!answer.isCorrect) return total;
    const speedRatio = Math.max(0, Math.min(1, 1 - Math.max(0, answer.responseTimeMs) / SPEED_REFERENCE_MS[level]));
    return total + Math.max(1, Math.round(SCORE_BASE[level] * (0.7 + speedRatio * 0.3)));
  }, 0);
}

export function progressFromAnswers(level: MatchData['level'], answers: LocalMultiplayerAnswer[]): MultiplayerProgressPayload {
  const correctAnswers = answers.filter((answer) => answer.isCorrect).length;
  return {
    score: answers.length ? Math.round((correctAnswers / answers.length) * 100) : 0,
    scorePoints: computeScorePoints(level, answers),
    correctAnswers,
    totalQuestions: answers.length,
    totalResponseTimeMs: answers.reduce((sum, answer) => sum + answer.responseTimeMs, 0),
    bestStreak: computeBestStreak(answers),
  };
}

export function makeLocalAnswer(
  question: MatchQuestion,
  questionIndex: number,
  userAnswer: number | null,
  responseTimeMs: number,
  source: 'manual' | 'timeout',
): LocalMultiplayerAnswer {
  return {
    questionIndex,
    prompt: question.prompt,
    correctAnswer: question.answer,
    userAnswer,
    responseTimeMs,
    skill: question.skill,
    source,
    isCorrect: userAnswer !== null && userAnswer === question.answer,
  };
}

export function upsertLocalAnswer(answers: LocalMultiplayerAnswer[], answer: LocalMultiplayerAnswer) {
  if (answers.some((item) => item.questionIndex === answer.questionIndex)) return answers;
  return [...answers, answer].sort((left, right) => left.questionIndex - right.questionIndex);
}

export function removeLocalAnswer(answers: LocalMultiplayerAnswer[], questionIndex: number) {
  return answers.filter((answer) => answer.questionIndex !== questionIndex);
}

export function buildResultPayload(startedAtMs: number, nowMs: number, answers: LocalMultiplayerAnswer[]): MultiplayerResultPayload {
  return {
    durationSeconds: Math.max(1, Math.round((nowMs - startedAtMs) / 1000)),
    bestStreak: computeBestStreak(answers),
    answers: answers.map(({ prompt, correctAnswer, userAnswer, responseTimeMs, skill }) => ({
      prompt,
      correctAnswer,
      userAnswer,
      responseTimeMs,
      skill,
    })),
  };
}

export function parseIntegerAnswer(value: string) {
  const trimmed = value.trim();
  if (!trimmed || !/^-?\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function remainingSeconds(targetMs: number, nowMs: number) {
  return Math.max(0, Math.ceil((targetMs - nowMs) / 1000));
}

export function shouldFinishSprint(match: MatchData | null, remaining: number | null, realtimeReady: boolean, alreadySubmitting: boolean) {
  return Boolean(
    match
    && match.status === 'in_progress'
    && match.challengeMode === 'sprint'
    && remaining !== null
    && remaining <= 0
    && realtimeReady
    && !alreadySubmitting,
  );
}

export function errorCode(error: unknown) {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : null;
}

export function isSettlementError(error: unknown) {
  return ['match_already_completed', 'match_not_in_progress'].includes(errorCode(error) ?? '');
}

export function isUnknownRealtimeOutcome(error: unknown) {
  return ['realtime_timeout', 'realtime_invalid_response'].includes(errorCode(error) ?? '');
}

export function isSettlementConfirmed(match: MatchData | null, matchId: string, playerId: string | null | undefined) {
  if (!match || match.id !== matchId) return false;
  if (match.status === 'completed') return true;
  const participant = match.participants.find((item) => item.player.id === playerId);
  return participant?.status === 'submitting' || participant?.status === 'completed';
}
