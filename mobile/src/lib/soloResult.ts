import type { SoloRun, SoloRunResult } from './api';

const PLAYER_MAX_LEVEL = 100;

export type SoloResultSummary = {
  accuracy: number;
  averageResponseTimeMs: number | null;
  bestStreak: number;
  correctAnswers: number;
  scorePoints: number;
  totalAnswers: number;
};

export type SoloXpJourney = {
  missionXp: number;
  sessionXp: number;
  totalAfter: number;
  totalBefore: number;
};

export function getSoloResultSummary(run: Pick<SoloRun, 'answers' | 'progress' | 'result'>): SoloResultSummary {
  const totalAnswers = run.answers.length;
  const correctAnswers = run.answers.filter((answer) => answer.isCorrect).length;
  const totalResponseTimeMs = run.answers.reduce((total, answer) => total + answer.responseTimeMs, 0);

  return {
    accuracy: totalAnswers > 0 ? Math.round((correctAnswers / totalAnswers) * 100) : 0,
    averageResponseTimeMs: totalAnswers > 0 ? Math.round(totalResponseTimeMs / totalAnswers) : null,
    bestStreak: run.progress.bestStreak,
    correctAnswers,
    scorePoints: run.result?.scorePoints ?? run.progress.scorePoints,
    totalAnswers,
  };
}

export function getSoloXpJourney(result: SoloRunResult | null, fallbackSessionXp: number): SoloXpJourney {
  const sessionXp = Math.max(0, result?.xpEarned ?? fallbackSessionXp);
  const missionXp = Math.max(0, result?.missionXpEarned ?? 0);
  const totalAfter = Math.max(sessionXp + missionXp, result?.playerProgress?.totalXp ?? sessionXp + missionXp);

  return {
    missionXp,
    sessionXp,
    totalAfter,
    totalBefore: Math.max(0, totalAfter - sessionXp - missionXp),
  };
}

export function getPlayerLevelFromXp(totalXp: number) {
  const safeTotalXp = Math.max(0, Math.floor(totalXp));
  let level = 1;

  for (let candidate = 2; candidate <= PLAYER_MAX_LEVEL; candidate += 1) {
    const requiredXp = Math.round(120 * Math.pow(candidate - 1, 1.85));
    if (safeTotalXp < requiredXp) break;
    level = candidate;
  }

  return level;
}

export function formatResponseTime(milliseconds: number | null) {
  if (milliseconds === null) return '—';
  if (milliseconds < 1_000) return `${milliseconds} ms`;
  return `${(milliseconds / 1_000).toFixed(1)} s`;
}

export function getSoloResultTitle(accuracy: number, totalAnswers: number) {
  if (totalAnswers === 0) return 'Partie terminée';
  if (accuracy >= 90) return 'Excellent résultat !';
  if (accuracy >= 75) return 'Bien joué !';
  if (accuracy >= 50) return 'Tu progresses !';
  return 'Encore un essai !';
}
