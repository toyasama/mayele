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
    totalGames: number
    bestScore: number
    totalPoints: number
    masteredTopics: number
  }
  progressByGame: Array<{
    game: string
    attempts: number
    bestScore: number
    averageScore: number
    lastPlayedAt: string | null
  }>
  recentSessions: Array<{
    id: number
    game: string
    score: number
    correctAnswers: number
    totalQuestions: number
    durationSeconds: number
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
      score: number
      correctAnswers: number
      totalQuestions: number
      durationSeconds: number
    },
  ) =>
    request<{ message: string }>('/sessions', {
      method: 'POST',
      token,
      body: JSON.stringify(data),
    }),
}
