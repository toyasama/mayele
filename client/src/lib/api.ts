import type { AnswerResult, SkillTag } from './game'

const API_BASE = import.meta.env.VITE_API_URL ?? '/api'

export type AuthUser = {
  id: number
  name: string
  email: string
  createdAt: string
}

export type AuthResponse = {
  token: string
  user: AuthUser
}

export type DashboardData = {
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
    id: number
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

type RequestOptions = RequestInit & {
  token?: string | null
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { token, headers, ...rest } = options

  const response = await fetch(`${API_BASE}${path}`, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers ?? {}),
    },
  })

  const contentType = response.headers.get('content-type') ?? ''
  const payload = contentType.includes('application/json') ? await response.json() : null

  if (!response.ok) {
    throw new Error(payload?.message ?? 'Une erreur est survenue.')
  }

  return payload as T
}

export const api = {
  register: (data: { name: string; email: string; password: string }) =>
    request<AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  login: (data: { email: string; password: string }) =>
    request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getMe: (token: string) =>
    request<{ user: AuthUser }>('/me', {
      method: 'GET',
      token,
    }),

  getDashboard: (token: string) =>
    request<DashboardData>('/dashboard', {
      method: 'GET',
      token,
    }),

  saveSession: (
    token: string,
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
      token,
      body: JSON.stringify(data),
    }),
}
