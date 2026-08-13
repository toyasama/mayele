import { describe, expect, it } from 'vitest';

import { generateMatchQuestion, matchQuestionIdentity } from './matchQuestions';

describe('questions multijoueur mobiles', () => {
  it('génère exactement la même première question que le serveur et le web', () => {
    expect(generateMatchQuestion('seed_1', 0, 'addition', 'debutant')).toEqual({
      prompt: '17 + 12', answer: 29, operation: 'addition', skill: 'addition',
    });
  });

  it('équilibre le mode mixte', () => {
    const counts = new Map<string, number>();
    for (let index = 0; index < 40; index += 1) {
      const operation = generateMatchQuestion('balanced-mixed', index, 'mixte', 'debutant').operation;
      counts.set(operation, (counts.get(operation) ?? 0) + 1);
    }
    expect(Object.fromEntries(counts)).toEqual({ addition: 10, soustraction: 10, multiplication: 10, division: 10 });
  });

  it('ne répète pas une addition inversée', () => {
    expect(matchQuestionIdentity({ prompt: '1 + 2', operation: 'addition' })).toBe(matchQuestionIdentity({ prompt: '2 + 1', operation: 'addition' }));
  });
});
