import { waitForAuthToken } from './authToken'
import type { AnswerResult, SkillTag } from './game'
import { resolveApiBase } from './runtimeConfig'

export type PresenceStatus = 'online' | 'away' | 'offline'

const API_BASE = resolveApiBase(import.meta.env.VITE_API_URL, undefined, { isProduction: import.meta.env.PROD })

export class ApiRequestError extends Error {
  declare readonly status: number
  declare readonly code: string | null

  constructor(message: string, status: number, code: string | null) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
    this.code = code
  }
}

export type AuthUser = {
  id: string
  clerkUserId: string
  name: string
  firstName: string | null
  lastName: string | null
  birthDate: string | null
  username: string | null
  avatarUrl: string | null
  timeZone: string
  presenceStatus: PresenceStatus
  presenceUpdatedAt: string
  email: string | null
  profileComplete: boolean
  createdAt: string
}

export type PublicPlayer = {
  id: string
  name: string
  username: string | null
  avatarUrl: string | null
  totalXp: number
  presenceStatus: PresenceStatus
  presenceUpdatedAt: string
}

export type NotificationData = {
  id: string
  type: string
  status: string
  title: string
  body: string | null
  href: string | null
  dedupeKey: string
  createdAt: string
  readAt: string | null
  dismissedAt: string | null
  actorPlayer: PublicPlayer | null
}

export type FriendRequestData = {
  id: string
  createdAt: string
  player: PublicPlayer
}

export type ChallengeMode = 'sprint' | 'tempo'

export type MatchParticipantData = {
  id: string
  status: string
  preferredChallengeMode: ChallengeMode | null
  preferredGame: string | null
  preferredLevel: string | null
  score: number | null
  scorePoints: number
  xp: number | null
  correctAnswers: number
  totalQuestions: number
  totalResponseTimeMs: number
  bestStreak: number
  joinedAt: string | null
  finishedAt: string | null
  forfeitedAt: string | null
  rematchRequestedAt: string | null
  resultDismissedAt: string | null
  challengeStats: {
    room: {
      wins: number
      losses: number
      draws: number
    }
    friendship: {
      wins: number
      losses: number
      draws: number
    }
  }
  player: PublicPlayer
}

export type MatchData = {
  id: string
  roomId: string | null
  type: string
  challengeMode: ChallengeMode | null
  status: string
  game: string | null
  level: string | null
  practiceSkill: SkillTag | null
  durationSeconds: number
  questionCount: number | null
  perQuestionTimeLimitSeconds: number | null
  questionSeed: string | null
  tempoQuestionIndex?: number | null
  tempoQuestionStartedAt?: string | null
  configVersion: number
  winnerPlayerId: string | null
  createdAt: string
  expiresAt: string
  endsAt: string | null
  serverNow: string
  hostActiveAt: string | null
  startedAt: string | null
  finishedAt: string | null
  createdBy: PublicPlayer
  participants: MatchParticipantData[]
}

export type TempoProgressData = {
  questionIndex: number
  answeredCount: number
  expectedAnswerCount: number
  complete: boolean
  nextQuestionIndex: number
}

export type PlayerProgress = {
  level: number
  maxLevel: number
  totalXp: number
  currentLevelXp: number
  nextLevel: number | null
  nextLevelXp: number
  xpIntoLevel: number
  xpForNextLevel: number
  xpRemaining: number
  progress: number
  isMaxLevel: boolean
}

export type SoloRunResult = {
  sessionId: string | null
  message: string
  scorePoints: number
  xpEarned: number
  missionXpEarned: number
  completedMissions: Array<{ key: string; title: string; rewardXp: number }>
  playerProgress: PlayerProgress
  earnedAchievements: Array<{ key: string; label: string }>
}

export type SoloRunQuestion = {
  index: number
  prompt: string
  operation: Exclude<AnswerResult['game'], 'mixte'>
  skill: SkillTag
  issuedAt: string
  deadlineAt: string
}

export type SoloRunProgress = {
  correctAnswers: number
  totalQuestions: number
  scorePoints: number
  xp: number
  currentStreak: number
  bestStreak: number
}

export type SoloRunAnswer = AnswerResult & {
  questionIndex: number
}

export type SoloRunData = {
  id: string
  clientRunId: string
  status: 'active' | 'finalizing' | 'completed' | 'abandoned' | 'expired'
  mode: ChallengeMode
  game: AnswerResult['game']
  level: AnswerResult['level']
  practiceSkill: SkillTag | null
  durationSeconds: number
  questionCount: number
  perQuestionTimeLimitSeconds: number | null
  currentQuestionIndex: number
  startedAt: string
  endsAt: string
  expiresAt: string
  finishedAt: string | null
  serverNow: string
  question: SoloRunQuestion | null
  progress: SoloRunProgress
  answers: SoloRunAnswer[]
  result: SoloRunResult | null
}

export type StartSoloRunPayload = {
  clientRunId: string
  mode: ChallengeMode
  game: AnswerResult['game']
  level: AnswerResult['level']
  practiceSkill: SkillTag | null
  sprintDurationSeconds: 60 | 90 | 120
  tempoQuestionCount: number
  tempoQuestionSeconds: number
}

export type DashboardData = {
  player: AuthUser
  summary: {
    totalSessions: number
    bestScore: number
    totalXp: number
    playerProgress: PlayerProgress
    averageAccuracy: number
    bestStreak: number
    lastPlayedAt: string | null
    favoriteGame: string | null
    todaySessions: number
    dailyGoal: number
  }
  practicePlan: {
    recommendedSkill: SkillTag | null
    recommendedLevel: string | null
    message: string
  }
  weakSkills: Array<{
    skill: SkillTag
    attempts: number
    correctAnswers: number
    accuracy: number
  }>
  missions: Array<{
    key: string
    title: string
    description: string
    rewardXp: number
    scope: 'daily' | 'lifetime'
    scopeKey: string
    current: number
    target: number
    progress: number
    completed: boolean
    claimed: boolean
    completedAt: string | null
  }>
  badges: Array<{
    key: string
    title: string
    description: string
    family: string
    familyLabel: string
    familyDescription: string
    tier: string
    level: string
    completed: boolean
    progress: number
    completedObjectives: number
    totalObjectives: number
    objectives: Array<{
      key: string
      label: string
      completed: boolean
      detail: string
    }>
  }>
  stats: {
    averageResponseTimeMs: number
    byGame: Array<{
      game: string
      attempts: number
      averageAccuracy: number
      bestScore: number
      bestStreak: number
      averageResponseTimeMs: number
      lastPlayedAt: string | null
    }>
    byLevel: Array<{
      level: string
      attempts: number
      averageAccuracy: number
      bestScore: number
      bestStreak: number
      averageResponseTimeMs: number
      lastPlayedAt: string | null
    }>
    bestCombination: {
      game: string
      level: string
      attempts: number
      averageAccuracy: number
      bestScore: number
      bestStreak: number
    } | null
    recentTrend: {
      sessions: number
      averageAccuracy: number
      averageXp: number
      bestStreak: number
      accuracyDelta: number
      xpDelta: number
    }
    records: {
      bestScore: number
      bestStreak: number
      bestXp: number
      fastestAverageResponseTimeMs: number | null
    }
  }
  achievements: Array<{
    key: string
    label: string
    description: string
    earnedAt: string
  }>
  progressByMode: Array<{
    game: string
    level: string
    attempts: number
    bestScore: number
    averageScore: number
    averageAccuracy: number
    bestStreak: number
    averageResponseTimeMs?: number
    lastPlayedAt: string | null
  }>
  recentSessions: Array<{
    id: string
    game: string
    level: string
    practiceSkill: SkillTag | null
    score: number
    scorePoints: number
    xp: number
    correctAnswers: number
    totalQuestions: number
    durationSeconds: number
    bestStreak: number
    playedAt: string
    answers: Array<{
      id: string
      prompt: string
      correctAnswer: number
      userAnswer: number | null
      responseTimeMs: number
      isCorrect: boolean
      skill: SkillTag
    }>
  }>
}

export type DailyObjective = DashboardData['missions'][number]

export type OperationHistorySession = {
  id: string
  score: number
  correctAnswers: number
  totalQuestions: number
  bestStreak: number
  playedAt: string
  averageResponseTimeMs: number
}

export type FriendProfileData = {
  player: PublicPlayer
  badges: Array<Pick<DashboardData['badges'][number], 'key' | 'title' | 'family' | 'familyLabel' | 'tier' | 'level'>>
  stats: {
    byGame: DashboardData['stats']['byGame']
    byLevel: DashboardData['stats']['byLevel']
  }
  headToHead?: {
    summary: { wins: number; losses: number; draws: number }
    recent: Array<{
      id: string
      playedAt: string
      challengeMode: ChallengeMode
      game: string
      level: string
      myScore: number | null
      friendScore: number | null
      outcome: 'win' | 'loss' | 'draw'
    }>
  }
}

type TokenProvider = () => Promise<string | null>

type RequestOptions = RequestInit & {
  getToken?: TokenProvider
}

// React pages and global providers can request the same resource during one
// navigation. Sharing only the in-flight GET keeps the response fresh while
// preventing duplicate network/DB work. Entries are removed as soon as the
// request settles, so this is not a data cache.
const inFlightGetRequests = new Map<string, Promise<unknown>>()
const TRANSIENT_GET_RETRY_DELAYS_MS = [250, 750]

function waitBeforeRetry(delayMs: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, delayMs))
}

function isRetryableGetError(error: unknown) {
  if (!(error instanceof ApiRequestError)) {
    return error instanceof Error
  }

  return error.status === 0 || error.status >= 500
}

async function executeGetWithRetry<T>(execute: () => Promise<T>) {
  for (const delayMs of TRANSIENT_GET_RETRY_DELAYS_MS) {
    try {
      return await execute()
    } catch (error) {
      if (!isRetryableGetError(error)) {
        throw error
      }

      await waitBeforeRetry(delayMs)
    }
  }

  return execute()
}

function apiUnavailableMessage() {
  const target = API_BASE.startsWith('http') ? API_BASE : `${window.location.origin}${API_BASE}`
  const isLocalApi = target.includes('localhost') || target.includes('127.0.0.1')

  if (isLocalApi) {
    return `Impossible de contacter l’API locale (${target}). Lancez le serveur dans le dossier server avec npm run dev.`
  }

  return 'Impossible de contacter l’API Mayele. Réessayez dans un instant.'
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { getToken, headers, ...rest } = options
  const token = getToken ? await waitForAuthToken(getToken) : null

  if (getToken && !token) {
    throw new ApiRequestError('Session en cours d initialisation.', 0, 'auth_pending')
  }

  const execute = async () => {
    let response: Response

    try {
      response = await fetch(`${API_BASE}${path}`, {
        ...rest,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(headers ?? {}),
        },
      })
    } catch {
      throw new Error(apiUnavailableMessage())
    }

    const contentType = response.headers.get('content-type') ?? ''
    const payload = contentType.includes('application/json') ? await response.json() : null

    if (!response.ok) {
      throw new ApiRequestError(payload?.message ?? 'Une erreur est survenue.', response.status, payload?.code ?? null)
    }

    return payload as T
  }

  const method = (rest.method ?? 'GET').toUpperCase()
  if (method !== 'GET') {
    return execute()
  }

  // Scope coalescing to the authenticated session: an in-flight response must
  // never be shared if the user changes while a request is pending.
  const requestKey = `${path}\u0000${token ?? 'anonymous'}`
  const existing = inFlightGetRequests.get(requestKey) as Promise<T> | undefined
  if (existing) {
    return existing
  }

  const pending = executeGetWithRetry(execute)
  inFlightGetRequests.set(requestKey, pending)

  try {
    return await pending
  } finally {
    if (inFlightGetRequests.get(requestKey) === pending) {
      inFlightGetRequests.delete(requestKey)
    }
  }
}

export const api = {
  getMe: (getToken: TokenProvider) =>
    request<{ user: AuthUser }>('/me', {
      method: 'GET',
      getToken,
    }),

  updateProfile: (
    getToken: TokenProvider,
    data: {
      firstName: string
      lastName: string
      birthDate: string
      username?: string
      timeZone?: string
      avatarUrl?: string | null
    },
  ) =>
    request<{ user: AuthUser }>('/me/profile', {
      method: 'PUT',
      getToken,
      body: JSON.stringify(data),
    }),

  updateTimeZone: (getToken: TokenProvider, timeZone: string) =>
    request<{ user: AuthUser }>('/me/time-zone', {
      method: 'PUT',
      getToken,
      body: JSON.stringify({ timeZone }),
    }),

  getDashboard: (getToken: TokenProvider) =>
    request<DashboardData>('/dashboard', {
      method: 'GET',
      cache: 'no-store',
      getToken,
    }),

  getOperationHistory: (getToken: TokenProvider, game: string, level: string, limit = 20) => {
    const params = new URLSearchParams({ game, level, limit: String(limit) })
    return request<{ sessions: OperationHistorySession[] }>(`/dashboard/operation-history?${params}`, {
      method: 'GET',
      getToken,
    })
  },

  getDailyObjectives: (getToken: TokenProvider) =>
    request<{ objectives: DailyObjective[] }>('/daily-objectives', {
      method: 'GET',
      cache: 'no-store',
      getToken,
    }),

  searchPlayers: (getToken: TokenProvider, username: string) =>
    request<{ players: PublicPlayer[] }>(`/players/search?username=${encodeURIComponent(username)}`, {
      method: 'GET',
      getToken,
    }),

  getFriends: (getToken: TokenProvider) =>
    request<{ friends: PublicPlayer[] }>('/friends', {
      method: 'GET',
      getToken,
    }),

  getFriendProfile: (getToken: TokenProvider, friendId: string) =>
    request<FriendProfileData>(`/friends/${encodeURIComponent(friendId)}/profile`, {
      method: 'GET',
      getToken,
    }),

  getFriendRequests: (getToken: TokenProvider) =>
    request<{ incoming: FriendRequestData[]; outgoing: FriendRequestData[] }>('/friends/requests', {
      method: 'GET',
      getToken,
    }),

  getSocialOverview: (getToken: TokenProvider) =>
    request<{ friends: PublicPlayer[]; incoming: FriendRequestData[]; outgoing: FriendRequestData[] }>('/friends/overview', {
      method: 'GET',
      getToken,
    }),

  getNotifications: (getToken: TokenProvider) =>
    request<{ notifications: NotificationData[]; unreadCount: number }>('/notifications', {
      method: 'GET',
      getToken,
    }),

  markNotificationRead: (getToken: TokenProvider, notificationId: string) =>
    request<{ notifications: NotificationData[]; unreadCount: number }>(`/notifications/${encodeURIComponent(notificationId)}/read`, {
      method: 'PUT',
      getToken,
    }),

  markAllNotificationsRead: (getToken: TokenProvider) =>
    request<{ notifications: NotificationData[]; unreadCount: number }>('/notifications/read-all', {
      method: 'PUT',
      getToken,
    }),

  deleteNotification: (getToken: TokenProvider, notificationId: string) =>
    request<{ notifications: NotificationData[]; unreadCount: number }>(`/notifications/${encodeURIComponent(notificationId)}`, {
      method: 'DELETE',
      getToken,
    }),

  sendFriendRequest: (getToken: TokenProvider, receiverPlayerId: string) =>
    request<{ request: FriendRequestData }>('/friends/requests', {
      method: 'POST',
      getToken,
      body: JSON.stringify({ receiverPlayerId }),
    }),

  acceptFriendRequest: (getToken: TokenProvider, requestId: string) =>
    request<{ friend: PublicPlayer }>(`/friends/requests/${encodeURIComponent(requestId)}/accept`, {
      method: 'POST',
      getToken,
    }),

  declineFriendRequest: (getToken: TokenProvider, requestId: string) =>
    request<{ player: PublicPlayer }>(`/friends/requests/${encodeURIComponent(requestId)}/decline`, {
      method: 'POST',
      getToken,
    }),

  cancelFriendRequest: (getToken: TokenProvider, requestId: string) =>
    request<{ player: PublicPlayer }>(`/friends/requests/${encodeURIComponent(requestId)}/cancel`, {
      method: 'POST',
      getToken,
    }),

  removeFriend: (getToken: TokenProvider, friendId: string) =>
    request<void>(`/friends/${encodeURIComponent(friendId)}`, {
      method: 'DELETE',
      getToken,
    }),

  getMatches: (getToken: TokenProvider) =>
    request<{ matches: MatchData[] }>('/matches', {
      method: 'GET',
      cache: 'no-store',
      getToken,
    }),

  getMatch: (getToken: TokenProvider, matchId: string) =>
    request<{ match: MatchData }>(`/matches/${encodeURIComponent(matchId)}`, {
      method: 'GET',
      cache: 'no-store',
      getToken,
    }),

  getMatchRoomOverview: (getToken: TokenProvider) =>
    request<{ friends: PublicPlayer[]; matches: MatchData[] }>('/matches/room-overview', {
      method: 'GET',
      cache: 'no-store',
      getToken,
    }),

  declineMatch: (getToken: TokenProvider, matchId: string) =>
    request<{ match: MatchData }>(`/matches/${encodeURIComponent(matchId)}/decline`, {
      method: 'POST',
      getToken,
    }),

  declineMatchProposal: (getToken: TokenProvider, matchId: string) =>
    request<{ match: MatchData }>(`/matches/${encodeURIComponent(matchId)}/proposal/decline`, {
      method: 'POST',
      getToken,
    }),

  heartbeatMatch: (getToken: TokenProvider, matchId: string) =>
    request<{ match: MatchData }>(`/matches/${encodeURIComponent(matchId)}/heartbeat`, {
      method: 'POST',
      getToken,
    }),

  transferMatchHost: (getToken: TokenProvider, matchId: string) =>
    request<{ match: MatchData }>(`/matches/${encodeURIComponent(matchId)}/transfer-host`, {
      method: 'POST',
      getToken,
    }),

  leaveMatch: (getToken: TokenProvider, matchId: string) =>
    request<{ match: MatchData }>(`/matches/${encodeURIComponent(matchId)}/leave`, {
      method: 'POST',
      getToken,
    }),

  submitMatchResult: (
    getToken: TokenProvider,
    matchId: string,
    data: {
      durationSeconds: number
      bestStreak: number
      answers: Array<{
        prompt: string
        correctAnswer: number
        userAnswer: number | null
        responseTimeMs: number
        skill: SkillTag
      }>
    },
  ) =>
    request<{ match: MatchData }>(`/matches/${encodeURIComponent(matchId)}/results`, {
      method: 'POST',
      getToken,
      body: JSON.stringify(data),
    }),

  startSoloRun: (getToken: TokenProvider, data: StartSoloRunPayload) =>
    request<{ run: SoloRunData }>('/solo-runs', {
      method: 'POST',
      getToken,
      body: JSON.stringify(data),
    }),

  getActiveSoloRun: (getToken: TokenProvider) =>
    request<{ run: SoloRunData | null }>('/solo-runs/active', {
      method: 'GET',
      cache: 'no-store',
      getToken,
    }),

  getSoloRun: (getToken: TokenProvider, runId: string) =>
    request<{ run: SoloRunData }>(`/solo-runs/${encodeURIComponent(runId)}`, {
      method: 'GET',
      cache: 'no-store',
      getToken,
    }),

  submitSoloAnswer: (
    getToken: TokenProvider,
    runId: string,
    data: { questionIndex: number; userAnswer: number | null },
  ) =>
    request<{ run: SoloRunData; correction: AnswerResult | null }>(`/solo-runs/${encodeURIComponent(runId)}/answers`, {
      method: 'POST',
      getToken,
      body: JSON.stringify(data),
    }),

  finishSoloRun: (getToken: TokenProvider, runId: string) =>
    request<{ run: SoloRunData }>(`/solo-runs/${encodeURIComponent(runId)}/finish`, {
      method: 'POST',
      getToken,
    }),
}
