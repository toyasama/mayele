import * as Crypto from 'expo-crypto';
import { io, type Socket } from 'socket.io-client';

import type { GameLevel, GameMode, GameType, MatchData, TempoProgress, TokenProvider } from './api';
import { readMobileConfig } from './config';

type RealtimeResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: { message: string; status: number; code: string | null } };

export type MultiplayerConfigPayload = {
  challengeMode: GameMode;
  game: GameType;
  level: GameLevel;
  practiceSkill?: null;
  durationSeconds?: number;
  questionCount?: number;
  perQuestionTimeLimitSeconds?: number;
  expectedConfigVersion?: number;
};

type InvitationPayload = MultiplayerConfigPayload & {
  opponentPlayerId: string;
};

export type MultiplayerAnswerPayload = {
  questionIndex: number;
  prompt: string;
  correctAnswer: number;
  userAnswer: number | null;
  responseTimeMs: number;
  skill: string;
  source: 'manual' | 'timeout';
};

export type MultiplayerResultPayload = {
  durationSeconds: number;
  bestStreak: number;
  answers: Omit<MultiplayerAnswerPayload, 'questionIndex' | 'source'>[];
};

export type MultiplayerProgressPayload = {
  score: number;
  scorePoints: number;
  correctAnswers: number;
  totalQuestions: number;
  totalResponseTimeMs: number;
  bestStreak: number;
};

export type TempoProgressPayload = {
  matchId: string;
  questionIndex: number;
  nextQuestionIndex: number;
  reason: string;
  at: string;
};

export type RoomRealtimeEvent = {
  roomId: string;
  matchId: string;
  eventId: string;
  revision: number;
  type: string;
  reason: string;
  serverTime: string;
  match: MatchData;
};

export type RoomSnapshotPayload = {
  roomId: string;
  matchId: string;
  revision: number;
  serverTime: string;
  match: MatchData;
};

export type TempoAnswerRecordedPayload = {
  matchId: string;
  questionIndex: number;
  playerId: string;
  match: MatchData;
  reason: string;
  at: string;
};

type MatchEventPayload = { match?: MatchData; roomEvent?: RoomRealtimeEvent };

export type MultiplayerRealtimeHandlers = {
  onMatch?: (match: MatchData) => void;
  onReady?: () => void;
  onDisconnected?: () => void;
  onRefreshRequested?: () => void;
  onTempoProgress?: (payload: TempoProgressPayload) => void;
  onTempoAnswerRecorded?: (payload: TempoAnswerRecordedPayload) => void;
  onRoomEvent?: (payload: RoomRealtimeEvent) => void;
  onRoomSnapshot?: (payload: RoomSnapshotPayload) => void;
  onError?: (error: Error) => void;
};

export type MultiplayerRealtimeConnection = {
  acceptInvitation(matchId: string): Promise<{ match: MatchData }>;
  acceptProposal(matchId: string): Promise<{ match: MatchData }>;
  createInvitation(payload: InvitationPayload): Promise<{ match: MatchData }>;
  declineInvitation(matchId: string): Promise<{ match: MatchData }>;
  declineProposal(matchId: string): Promise<{ match: MatchData }>;
  disconnect(): void;
  forfeit(matchId: string, progress?: MultiplayerProgressPayload): Promise<{ match: MatchData }>;
  joinRoom(roomId: string, lastSeenEventId?: string | null): Promise<{ joined: true }>;
  leave(matchId: string): Promise<{ match: MatchData }>;
  propose(matchId: string, config: MultiplayerConfigPayload): Promise<{ match: MatchData }>;
  requestRematch(matchId: string): Promise<{ match: MatchData }>;
  setPresenceActivity(active: boolean): void;
  submitResult(matchId: string, result: MultiplayerResultPayload): Promise<{ match: MatchData }>;
  submitSprintAnswer(matchId: string, answer: MultiplayerAnswerPayload): Promise<{ match: MatchData }>;
  submitTempoAnswer(matchId: string, answer: MultiplayerAnswerPayload): Promise<{ match: MatchData; progress: TempoProgress }>;
  updateConfig(matchId: string, config: MultiplayerConfigPayload): Promise<{ match: MatchData }>;
  updateProgress(matchId: string, progress: MultiplayerProgressPayload): Promise<{ match: MatchData }>;
};

type ReadyWaiter = {
  resolve: () => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

function realtimeError(response: Extract<RealtimeResponse<unknown>, { ok: false }>) {
  const error = new Error(response.error.message || 'Réponse multijoueur invalide.');
  Object.assign(error, { code: response.error.code, status: response.error.status });
  return error;
}

function localRealtimeError(message: string, code: string) {
  const error = new Error(message);
  Object.assign(error, { code, status: 0 });
  return error;
}

function commandTimeoutMs(eventName: string) {
  if (['room:join', 'match:update-config', 'match:update-progress', 'match:submit-tempo-answer', 'match:submit-sprint-answer'].includes(eventName)) return 4_000;
  if (eventName === 'match:submit-result') return 20_000;
  return 12_000;
}

export async function connectMultiplayerRealtime(
  getToken: TokenProvider,
  handlers: MultiplayerRealtimeHandlers = {},
): Promise<MultiplayerRealtimeConnection> {
  const token = await getToken().catch(() => null);
  if (!token) throw new Error('La session ne fournit aucun jeton pour le temps réel.');

  const { realtimeBaseUrl } = readMobileConfig();
  const socket: Socket = io(realtimeBaseUrl, {
    auth: { token },
    autoConnect: false,
    path: '/socket.io',
    transports: ['websocket', 'polling'],
  });
  let disposed = false;
  let ready = false;
  let refreshingAuth = false;
  const readyWaiters = new Set<ReadyWaiter>();

  function resolveReadyWaiters() {
    for (const waiter of readyWaiters) {
      clearTimeout(waiter.timer);
      waiter.resolve();
    }
    readyWaiters.clear();
  }

  function waitUntilReady() {
    if (ready && socket.connected) return Promise.resolve();
    if (disposed) return Promise.reject(localRealtimeError('Connexion multijoueur fermée.', 'realtime_closed'));
    if (!socket.connected) socket.connect();
    return new Promise<void>((resolve, reject) => {
      const waiter: ReadyWaiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          readyWaiters.delete(waiter);
          reject(localRealtimeError('Connexion multijoueur impossible.', 'realtime_unavailable'));
        }, 12_000),
      };
      readyWaiters.add(waiter);
    });
  }

  socket.on('realtime:ready', () => {
    ready = true;
    resolveReadyWaiters();
    handlers.onReady?.();
  });
  socket.on('disconnect', () => {
    ready = false;
    handlers.onDisconnected?.();
  });
  socket.on('connect_error', (reason) => {
    ready = false;
    if (reason.message === 'unauthorized' && !refreshingAuth) {
      refreshingAuth = true;
      socket.disconnect();
      void getToken()
        .then((refreshedToken) => {
          if (disposed || !refreshedToken) throw new Error('Session expirée. Reconnecte-toi.');
          socket.auth = { token: refreshedToken };
          socket.connect();
        })
        .catch((error) => handlers.onError?.(error instanceof Error ? error : new Error('Authentification temps réel impossible.')))
        .finally(() => { refreshingAuth = false; });
      return;
    }
    handlers.onError?.(new Error(reason.message || 'Connexion multijoueur impossible.'));
  });
  socket.on('match:changed', (payload: MatchEventPayload) => {
    const match = payload.roomEvent?.match ?? payload.match;
    if (payload.roomEvent) handlers.onRoomEvent?.(payload.roomEvent);
    if (match) handlers.onMatch?.(match);
  });
  socket.on('room:event', (payload: RoomRealtimeEvent) => {
    handlers.onRoomEvent?.(payload);
    handlers.onMatch?.(payload.match);
  });
  socket.on('room:snapshot', (payload: RoomSnapshotPayload) => {
    handlers.onRoomSnapshot?.(payload);
    handlers.onMatch?.(payload.match);
  });
  socket.on('match:tempo-answer-recorded', (payload: TempoAnswerRecordedPayload) => {
    handlers.onTempoAnswerRecorded?.(payload);
    handlers.onMatch?.(payload.match);
  });
  socket.on('match:tempo-progress', (payload: TempoProgressPayload) => handlers.onTempoProgress?.(payload));
  socket.on('social:changed', () => handlers.onRefreshRequested?.());
  socket.on('notifications:changed', () => handlers.onRefreshRequested?.());
  socket.connect();

  async function command<T>(eventName: string, payload: Record<string, unknown>) {
    if (disposed) throw localRealtimeError('Connexion multijoueur fermée.', 'realtime_closed');
    await waitUntilReady();

    return new Promise<T>((resolve, reject) => {
      socket.timeout(commandTimeoutMs(eventName)).emit(
        eventName,
        { ...payload, clientCommandId: Crypto.randomUUID() },
        (timeoutError: Error | null, response?: RealtimeResponse<T>) => {
          if (timeoutError) {
            reject(localRealtimeError('Commande temps réel expirée.', 'realtime_timeout'));
            return;
          }
          if (!response?.ok) {
            reject(response ? realtimeError(response) : localRealtimeError('Réponse multijoueur invalide.', 'realtime_invalid_response'));
            return;
          }
          resolve(response.data);
        },
      );
    });
  }

  return {
    acceptInvitation: (matchId) => command('match:accept-invitation', { matchId }),
    acceptProposal: (matchId) => command('match:accept-proposal', { matchId }),
    createInvitation: (payload) => command('match:create-invitation', payload),
    declineInvitation: (matchId) => command('match:decline-invitation', { matchId }),
    declineProposal: (matchId) => command('match:decline-proposal', { matchId }),
    disconnect: () => {
      disposed = true;
      for (const waiter of readyWaiters) {
        clearTimeout(waiter.timer);
        waiter.reject(localRealtimeError('Connexion multijoueur fermée.', 'realtime_closed'));
      }
      readyWaiters.clear();
      socket.disconnect();
    },
    forfeit: (matchId, progress) => command('match:forfeit', progress ? { matchId, progress } : { matchId }),
    joinRoom: (roomId, lastSeenEventId) => command('room:join', { roomId, lastSeenEventId: lastSeenEventId ?? null }),
    leave: (matchId) => command('match:leave', { matchId }),
    propose: (matchId, config) => command('match:propose', { matchId, config }),
    requestRematch: (matchId) => command('match:request-rematch', { matchId }),
    setPresenceActivity: (active) => {
      if (socket.connected) socket.emit('presence:activity', { active });
    },
    submitResult: (matchId, result) => command('match:submit-result', { matchId, result }),
    submitSprintAnswer: (matchId, answer) => command('match:submit-sprint-answer', { matchId, answer }),
    submitTempoAnswer: (matchId, answer) => command('match:submit-tempo-answer', { matchId, answer }),
    updateConfig: (matchId, config) => command('match:update-config', { matchId, config }),
    updateProgress: (matchId, progress) => command('match:update-progress', { matchId, progress }),
  };
}

async function withConnection<T>(getToken: TokenProvider, run: (connection: MultiplayerRealtimeConnection) => Promise<T>) {
  const connection = await connectMultiplayerRealtime(getToken);
  try {
    return await run(connection);
  } finally {
    connection.disconnect();
  }
}

export function createMultiplayerInvitation(getToken: TokenProvider, payload: InvitationPayload) {
  return withConnection(getToken, (connection) => connection.createInvitation(payload));
}

export function acceptMultiplayerInvitation(getToken: TokenProvider, matchId: string) {
  return withConnection(getToken, (connection) => connection.acceptInvitation(matchId));
}

export function cancelMultiplayerInvitation(getToken: TokenProvider, matchId: string) {
  return withConnection(getToken, (connection) => connection.leave(matchId));
}
