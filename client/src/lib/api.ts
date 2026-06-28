import type { AnswerResult, SkillTag } from './game'

const API_BASE = import.meta.env.VITE_API_URL ?? '/api'

export type AuthUser = {
  id: string
  clerkUserId: string
  name: string
  email: string | null
  createdAt: string
}

export type DashboardData = {
  player: AuthUser
  summary: {
    totalSessions: number
    bestScore: number
    totalPoints: number
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
    lastPlayedAt: string | null
  }>
  recentSessions: Array<{
    id: string
    game: string
    level: string
    practiceSkill: SkillTag | null
    score: number
    points: number
    correctAnswers: number
    totalQuestions: number
    durationSeconds: number
    bestStreak: number
    playedAt: string
  }>
}

type TokenProvider = () => Promise<string | null>

type RequestOptions = RequestInit & {
  getToken?: TokenProvider
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
  const token = getToken ? await getToken() : null

  if (getToken && !token) {
    throw new Error('Connexion requise.')
  }

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
    throw new Error(payload?.message ?? 'Une erreur est survenue.')
  }

  return payload as T
}

export const api = {
  getMe: (getToken: TokenProvider) =>
    request<{ user: AuthUser }>('/me', {
      method: 'GET',
      getToken,
    }),

  getDashboard: (getToken: TokenProvider) =>
    request<DashboardData>('/dashboard', {
      method: 'GET',
      getToken,
    }),

  saveSession: (
    getToken: TokenProvider,
    data: {
      game: string
      level: string
      practiceSkill: SkillTag | null
      score: number
      points: number
      correctAnswers: number
      totalQuestions: number
      durationSeconds: number
      bestStreak: number
      answers: AnswerResult[]
    },
  ) =>
    request<{ message: string; earnedAchievements: Array<{ key: string; label: string }> }>('/sessions', {
      method: 'POST',
      getToken,
      body: JSON.stringify(data),
    }),
}
