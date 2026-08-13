import { describe, expect, it } from 'vitest';

import type { SoloRun, SoloRunResult } from './api';
import { formatResponseTime, getPlayerLevelFromXp, getSoloResultSummary, getSoloXpJourney } from './soloResult';

const progress: SoloRun['progress'] = {
  bestStreak: 2,
  correctAnswers: 2,
  currentStreak: 1,
  scorePoints: 12,
  totalQuestions: 3,
  xp: 20,
};

const answers: SoloRun['answers'] = [
  { questionIndex: 0, prompt: '1 + 1', correctAnswer: 2, userAnswer: 2, responseTimeMs: 800, isCorrect: true, game: 'addition', level: 'debutant', skill: 'addition' },
  { questionIndex: 1, prompt: '2 + 2', correctAnswer: 4, userAnswer: 5, responseTimeMs: 1_500, isCorrect: false, game: 'addition', level: 'debutant', skill: 'addition' },
  { questionIndex: 2, prompt: '3 + 3', correctAnswer: 6, userAnswer: 6, responseTimeMs: 2_200, isCorrect: true, game: 'addition', level: 'debutant', skill: 'addition' },
];

describe('solo result helpers', () => {
  it('calcule les quatre statistiques à partir des réponses enregistrées', () => {
    expect(getSoloResultSummary({ answers, progress, result: null })).toEqual({
      accuracy: 67,
      averageResponseTimeMs: 1_500,
      bestStreak: 2,
      correctAnswers: 2,
      scorePoints: 12,
      totalAnswers: 3,
    });
  });

  it('retrouve le total XP avant la partie et isole le bonus de missions', () => {
    const result = {
      xpEarned: 20,
      missionXpEarned: 40,
      playerProgress: { totalXp: 560 },
    } as SoloRunResult;

    expect(getSoloXpJourney(result, 0)).toEqual({
      missionXp: 40,
      sessionXp: 20,
      totalAfter: 560,
      totalBefore: 500,
    });
  });

  it('formate les temps courts et les secondes', () => {
    expect(formatResponseTime(800)).toBe('800 ms');
    expect(formatResponseTime(1_500)).toBe('1.5 s');
    expect(formatResponseTime(null)).toBe('—');
  });

  it('retrouve le niveau correspondant aux XP affichés aux extrémités de la barre', () => {
    expect(getPlayerLevelFromXp(0)).toBe(1);
    expect(getPlayerLevelFromXp(119)).toBe(1);
    expect(getPlayerLevelFromXp(120)).toBe(2);
    expect(getPlayerLevelFromXp(4_653)).toBe(8);
  });
});
