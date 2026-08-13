import { describe, expect, it } from 'vitest';

import type { MatchData } from './api';
import { buildResultPayload, makeLocalAnswer, parseIntegerAnswer, progressFromAnswers, shouldFinishSprint, upsertLocalAnswer } from './multiplayerGame';

const sprintMatch = { status: 'in_progress', challengeMode: 'sprint', level: 'debutant' } as MatchData;

describe('moteur multijoueur mobile', () => {
  it('ne termine jamais un sprint avant l’initialisation réelle du chrono', () => {
    expect(shouldFinishSprint(sprintMatch, null, true, false)).toBe(false);
    expect(shouldFinishSprint(sprintMatch, 60, true, false)).toBe(false);
    expect(shouldFinishSprint(sprintMatch, 0, true, false)).toBe(true);
  });

  it('rejette les réponses décimales et accepte les entiers négatifs', () => {
    expect(parseIntegerAnswer('12')).toBe(12);
    expect(parseIntegerAnswer('-4')).toBe(-4);
    expect(parseIntegerAnswer('1,5')).toBeNull();
    expect(parseIntegerAnswer('')).toBeNull();
  });

  it('déduplique une réponse et calcule le payload comme le client web', () => {
    const correct = makeLocalAnswer({ prompt: '2 + 2', answer: 4, operation: 'addition', skill: 'addition' }, 0, 4, 1_000, 'manual');
    const wrong = makeLocalAnswer({ prompt: '3 + 3', answer: 6, operation: 'addition', skill: 'addition' }, 1, 5, 2_000, 'manual');
    const answers = upsertLocalAnswer(upsertLocalAnswer([], correct), correct);
    const finalAnswers = upsertLocalAnswer(answers, wrong);
    expect(finalAnswers).toHaveLength(2);
    expect(progressFromAnswers('debutant', finalAnswers)).toMatchObject({ correctAnswers: 1, totalQuestions: 2, bestStreak: 1 });
    expect(buildResultPayload(1_000, 61_000, finalAnswers)).toMatchObject({ durationSeconds: 60, bestStreak: 1 });
  });
});
