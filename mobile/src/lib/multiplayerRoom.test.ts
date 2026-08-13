import { describe, expect, it } from 'vitest';

import type { MatchData } from './api';
import { configFromMatch, configPayload, isParticipantInRoom, selectActiveRoomMatch } from './multiplayerRoom';

function match(status: string, participantStatus = 'accepted', expiresAt = '2099-01-01T00:00:00.000Z') {
  return {
    id: `${status}-${participantStatus}`,
    status,
    expiresAt,
    createdAt: '2026-08-13T10:00:00.000Z',
    participants: [{ status: participantStatus, player: { id: 'me' } }],
  } as MatchData;
}

describe('salon multijoueur mobile', () => {
  it('sélectionne aussi une invitation entrante et privilégie le salon le plus avancé', () => {
    const pending = match('pending', 'invited');
    const accepted = match('accepted');
    expect(selectActiveRoomMatch([pending, accepted], 'me')?.id).toBe(accepted.id);
    expect(selectActiveRoomMatch([pending], 'me')?.id).toBe(pending.id);
  });

  it('ignore un salon expiré ou quitté', () => {
    expect(selectActiveRoomMatch([match('accepted', 'accepted', '2020-01-01T00:00:00.000Z')], 'me')).toBeNull();
    expect(selectActiveRoomMatch([match('accepted', 'declined')], 'me')).toBeNull();
  });

  it('restaure un résultat encore visible sans le faire passer devant une partie active', () => {
    const completed = {
      ...match('completed', 'completed'),
      participants: [{ ...match('completed', 'completed').participants[0], resultDismissedAt: null }],
    } as MatchData;
    expect(selectActiveRoomMatch([completed], 'me')?.id).toBe(completed.id);
    expect(selectActiveRoomMatch([completed, match('in_progress', 'playing')], 'me')?.status).toBe('in_progress');
    expect(selectActiveRoomMatch([{ ...completed, participants: [{ ...completed.participants[0], resultDismissedAt: '2026-08-13T10:02:00.000Z' }] }], 'me')).toBeNull();
  });

  it('reconnaît l’entrée effective dans le salon', () => {
    expect(isParticipantInRoom('invited')).toBe(false);
    expect(isParticipantInRoom('accepted')).toBe(true);
    expect(isParticipantInRoom('playing')).toBe(true);
  });

  it('construit une configuration versionnée sans champs Sprint en Tempo', () => {
    const source = {
      ...match('accepted'),
      challengeMode: 'tempo',
      game: 'multiplication',
      level: 'avance',
      durationSeconds: 60,
      questionCount: 40,
      perQuestionTimeLimitSeconds: 12,
    } as MatchData;
    expect(configPayload(configFromMatch(source), 3)).toEqual({
      challengeMode: 'tempo',
      game: 'multiplication',
      level: 'avance',
      practiceSkill: null,
      questionCount: 40,
      perQuestionTimeLimitSeconds: 12,
      expectedConfigVersion: 3,
    });
  });
});
