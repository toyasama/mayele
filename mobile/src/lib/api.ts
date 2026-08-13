import { readMobileConfig } from './config';

export type TokenProvider = () => Promise<string | null>;
export type GameMode = 'sprint' | 'tempo';
export type GameType = 'addition' | 'soustraction' | 'multiplication' | 'division' | 'mixte';
export type GameLevel = 'debutant' | 'intermediaire' | 'avance' | 'expert';

export type DailyObjective = {
  version: number;
  key: string;
  family: 'sessions' | 'valid_answers' | 'correct_answers' | 'accuracy' | 'streak' | 'diversity';
  familyLabel: string;
  tier: 'easy' | 'medium' | 'hard';
  tierLabel: string;
  title: string;
  description: string;
  rewardXp: number;
  scope: 'daily';
  scopeKey: string;
  target: number;
  current: number;
  progress: number;
  completed: boolean;
  claimed: boolean;
  requirements: {
    playContext: 'solo' | 'multiplayer';
    challengeMode: GameMode;
    game: GameType | null;
    level: GameLevel;
  };
  launchConfig: {
    playContext: 'solo' | 'multiplayer';
    challengeMode: GameMode;
    game: GameType;
    level: GameLevel;
    sprintDurationSeconds: number | null;
    tempoQuestionCount: number | null;
    tempoQuestionSeconds: number | null;
  };
};

export type Player = {
  id: string; name: string; firstName: string | null; lastName: string | null;
  birthDate?: string | null; username: string | null; avatarUrl?: string | null; email: string | null; profileComplete: boolean;
  presenceStatus?: 'online' | 'away' | 'offline';
};

export type PublicPlayer = {
  id: string;
  name: string;
  username: string | null;
  avatarUrl: string | null;
  totalXp: number;
  presenceStatus: 'online' | 'away' | 'offline';
  presenceUpdatedAt: string;
};

export type MatchParticipantData = {
  id: string;
  status: string;
  preferredChallengeMode: GameMode | null;
  preferredGame: GameType | null;
  preferredLevel: GameLevel | null;
  score: number | null;
  scorePoints: number;
  xp: number | null;
  correctAnswers: number;
  totalQuestions: number;
  totalResponseTimeMs: number;
  bestStreak: number;
  joinedAt: string | null;
  finishedAt: string | null;
  forfeitedAt: string | null;
  rematchRequestedAt: string | null;
  resultDismissedAt: string | null;
  challengeStats: {
    room: { wins: number; losses: number; draws: number };
    friendship: { wins: number; losses: number; draws: number };
  };
  player: PublicPlayer;
};

export type MatchData = {
  id: string;
  roomId: string | null;
  type: string;
  status: string;
  challengeMode: GameMode | null;
  game: GameType | null;
  level: GameLevel | null;
  practiceSkill: string | null;
  durationSeconds: number;
  questionCount: number | null;
  perQuestionTimeLimitSeconds: number | null;
  questionSeed: string | null;
  tempoQuestionIndex?: number | null;
  tempoQuestionStartedAt?: string | null;
  configVersion: number;
  winnerPlayerId: string | null;
  createdAt: string;
  expiresAt: string;
  endsAt: string | null;
  serverNow: string;
  hostActiveAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdBy: PublicPlayer;
  participants: MatchParticipantData[];
};

export type TempoProgress = {
  questionIndex: number;
  answeredCount: number;
  expectedAnswerCount: number;
  complete: boolean;
  nextQuestionIndex: number;
};

export type PlayerProgress = {
  level: number;
  maxLevel: number;
  totalXp: number;
  currentLevelXp: number;
  nextLevel: number | null;
  nextLevelXp: number;
  xpIntoLevel: number;
  xpForNextLevel: number;
  xpRemaining: number;
  progress: number;
  isMaxLevel: boolean;
};

export type SoloRunResult = {
  sessionId: string | null;
  message: string;
  scorePoints: number;
  xpEarned: number;
  missionXpEarned: number;
  completedMissions: { key: string; title: string; rewardXp: number }[];
  playerProgress: PlayerProgress;
  earnedAchievements: { key: string; label: string }[];
};

export type SoloRun = {
  id: string;
  status: 'active' | 'finalizing' | 'completed' | 'abandoned' | 'expired';
  mode: GameMode;
  game: GameType;
  level: GameLevel;
  durationSeconds: number;
  questionCount: number;
  perQuestionTimeLimitSeconds: number | null;
  currentQuestionIndex: number;
  startedAt: string;
  endsAt: string;
  serverNow: string;
  question: { index: number; prompt: string; operation: Exclude<GameType, 'mixte'>; skill: string; issuedAt: string; deadlineAt: string } | null;
  nextQuestion: { index: number; prompt: string; operation: Exclude<GameType, 'mixte'>; skill: string } | null;
  progress: { correctAnswers: number; totalQuestions: number; scorePoints: number; xp: number; currentStreak: number; bestStreak: number };
  answers: SoloRunAnswer[];
  result: SoloRunResult | null;
};

export type SoloRunAnswer = {
  questionIndex: number; prompt: string; correctAnswer: number; userAnswer: number | null;
  responseTimeMs: number; isCorrect: boolean; game: GameType; level: GameLevel; skill: string;
};

export type StartSoloRunPayload = {
  clientRunId: string; mode: GameMode; game: GameType; level: GameLevel;
  practiceSkill: null; sprintDurationSeconds: 60 | 90 | 120;
  tempoQuestionCount: number; tempoQuestionSeconds: number;
};

export const apiBaseLabel = process.env.EXPO_PUBLIC_API_URL?.trim() ?? 'API non configurée';

async function apiRequest<T>(path: string, getToken: TokenProvider, init: RequestInit = {}): Promise<T> {
  const { apiBaseUrl } = readMobileConfig();
  const token = await getToken();
  if (!token) throw new Error("La session Clerk est active, mais aucun jeton API n’est disponible.");
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string; code?: string } | null;
    const error = new Error(body?.message ?? `L’API Mayele a répondu ${response.status}.`);
    Object.assign(error, { status: response.status, code: body?.code });
    throw error;
  }
  return response.json() as Promise<T>;
}

export async function getCurrentPlayer(getToken: TokenProvider) {
  return (await apiRequest<{ user: Player }>('/me', getToken)).user;
}

export async function getDailyObjectives(getToken: TokenProvider) {
  return (await apiRequest<{ objectives: DailyObjective[] }>('/daily-objectives', getToken, { cache: 'no-store' })).objectives;
}

export async function getMatchRoomOverview(getToken: TokenProvider) {
  return apiRequest<{ friends: PublicPlayer[]; matches: MatchData[] }>('/matches/room-overview', getToken, { cache: 'no-store' });
}

export async function getMatch(getToken: TokenProvider, matchId: string) {
  return (await apiRequest<{ match: MatchData }>(`/matches/${encodeURIComponent(matchId)}`, getToken, { cache: 'no-store' })).match;
}

export async function heartbeatMatch(getToken: TokenProvider, matchId: string) {
  return (await apiRequest<{ match: MatchData }>(`/matches/${encodeURIComponent(matchId)}/heartbeat`, getToken, { method: 'POST' })).match;
}

export async function leaveMatch(getToken: TokenProvider, matchId: string) {
  return (await apiRequest<{ match: MatchData }>(`/matches/${encodeURIComponent(matchId)}/leave`, getToken, { method: 'POST' })).match;
}

export async function updateCurrentPlayer(getToken: TokenProvider, payload: { firstName: string; lastName: string; birthDate: string; username: string; timeZone?: string }) {
  return (await apiRequest<{ user: Player }>('/me/profile', getToken, { method: 'PUT', body: JSON.stringify(payload) })).user;
}

export async function startSoloRun(getToken: TokenProvider, payload: StartSoloRunPayload) {
  return (await apiRequest<{ run: SoloRun }>('/solo-runs', getToken, { method: 'POST', body: JSON.stringify(payload) })).run;
}

export async function getSoloRun(getToken: TokenProvider, runId: string) {
  return (await apiRequest<{ run: SoloRun }>(`/solo-runs/${encodeURIComponent(runId)}`, getToken)).run;
}

export async function submitSoloAnswer(getToken: TokenProvider, runId: string, questionIndex: number, userAnswer: number | null) {
  return apiRequest<{ run: SoloRun; correction: SoloRunAnswer | null }>(`/solo-runs/${encodeURIComponent(runId)}/answers`, getToken, {
    method: 'POST', body: JSON.stringify({ questionIndex, userAnswer }),
  });
}

export async function finishSoloRun(getToken: TokenProvider, runId: string) {
  return (await apiRequest<{ run: SoloRun }>(`/solo-runs/${encodeURIComponent(runId)}/finish`, getToken, { method: 'POST' })).run;
}
