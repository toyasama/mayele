import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, type AuthResponse, type AuthUser } from '../lib/api'
import { AuthContext, type AuthContextValue } from './auth'

const STORAGE_TOKEN_KEY = 'mayele-token'
const STORAGE_USER_KEY = 'mayele-user'

function readStoredUser(): AuthUser | null {
  const raw = localStorage.getItem(STORAGE_USER_KEY)

  if (!raw) {
    return null
  }

  try {
    return JSON.parse(raw) as AuthUser
  } catch {
    localStorage.removeItem(STORAGE_USER_KEY)
    return null
  }
}

function persistAuth(response: AuthResponse) {
  localStorage.setItem(STORAGE_TOKEN_KEY, response.token)
  localStorage.setItem(STORAGE_USER_KEY, JSON.stringify(response.user))
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(STORAGE_TOKEN_KEY))
  const [user, setUser] = useState<AuthUser | null>(() => readStoredUser())
  const [loading, setLoading] = useState<boolean>(() => Boolean(localStorage.getItem(STORAGE_TOKEN_KEY)))

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_TOKEN_KEY)
    localStorage.removeItem(STORAGE_USER_KEY)
    setToken(null)
    setUser(null)
    setLoading(false)
  }, [])

  const applyAuth = useCallback((response: AuthResponse) => {
    persistAuth(response)
    setToken(response.token)
    setUser(response.user)
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!token) {
      return
    }

    let active = true

    api
      .getMe(token)
      .then((payload) => {
        if (!active) {
          return
        }

        setUser(payload.user)
        localStorage.setItem(STORAGE_USER_KEY, JSON.stringify(payload.user))
      })
      .catch(() => {
        if (active) {
          logout()
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [token, logout])

  const login = useCallback(
    async (email: string, password: string) => {
      const response = await api.login({ email, password })
      applyAuth(response)
    },
    [applyAuth],
  )

  const register = useCallback(
    async (name: string, email: string, password: string) => {
      const response = await api.register({ name, email, password })
      applyAuth(response)
    },
    [applyAuth],
  )

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      loading,
      isAuthenticated: Boolean(token && user),
      login,
      register,
      logout,
    }),
    [user, token, loading, login, register, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
