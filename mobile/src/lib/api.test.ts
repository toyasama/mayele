import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getDailyObjectives, leaveMatch, startSoloRun } from './api';

const payload = {
  clientRunId: '6269d73b-0235-4d35-b3e3-887f80407c5d',
  mode: 'sprint' as const,
  game: 'addition' as const,
  level: 'debutant' as const,
  practiceSkill: null,
  sprintDurationSeconds: 60 as const,
  tempoQuestionCount: 10,
  tempoQuestionSeconds: 10,
};

describe('API du jeu solo', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_API_URL = 'http://192.168.1.42:4000/api';
    process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_example';
  });
  afterEach(() => vi.unstubAllGlobals());

  it('démarre un run avec le jeton Clerk et la configuration choisie', async () => {
    const run = { id: 'run-1' };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ run }), { status: 201, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(startSoloRun(async () => 'jwt-mobile', payload)).resolves.toEqual(run);
    expect(fetchMock).toHaveBeenCalledWith('http://192.168.1.42:4000/api/solo-runs', expect.objectContaining({
      method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer jwt-mobile' }), body: JSON.stringify(payload),
    }));
  });

  it('refuse un appel sans jeton Clerk', async () => {
    await expect(startSoloRun(async () => null, payload)).rejects.toThrow('aucun jeton API');
  });

  it('retransmet le message métier du serveur', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: 'Profil incomplet.' }), { status: 428, headers: { 'Content-Type': 'application/json' } })));
    await expect(startSoloRun(async () => 'jwt-mobile', payload)).rejects.toThrow('Profil incomplet.');
  });

  it('récupère les objectifs quotidiens sans cache avec le jeton Clerk', async () => {
    const objectives = [{ key: 'daily-v2-easy', title: 'Viser juste' }];
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ objectives }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getDailyObjectives(async () => 'jwt-mobile')).resolves.toEqual(objectives);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://192.168.1.42:4000/api/daily-objectives',
      expect.objectContaining({
        cache: 'no-store',
        headers: expect.objectContaining({ Authorization: 'Bearer jwt-mobile' }),
      }),
    );
  });

  it('peut fermer un résultat multijoueur par HTTP si le temps réel est indisponible', async () => {
    const match = { id: 'match/avec espace', status: 'completed' };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ match }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(leaveMatch(async () => 'jwt-mobile', match.id)).resolves.toEqual(match);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://192.168.1.42:4000/api/matches/match%2Favec%20espace/leave',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer jwt-mobile' }),
      }),
    );
  });
});
