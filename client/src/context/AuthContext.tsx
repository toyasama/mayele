import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { api, type AuthResponse, type AuthUser } from '../lib/api'

type AuthContextValue = {
  user: AuthUser | null
  token: string | null
  loading: boolean
  isAuthenticated: boolean
  login: (email: string, password: string) => Promise<void>
  register: (name: string, email: string, password: string) => Promise<void>
  logout: () => void
}

const STORAGE_TOKEN_KEY = 'mayele-token'
const STORAGE_USER_KEY = 'mayele-user'

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

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
  const [loading, setLoading] = useState<boolean>(Boolean(localStorage.getItem(STORAGE_TOKEN_KEY)))

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
      setLoading(false)
      return
    }

    setLoading(true)
    api
      .getMe(token)
      .then((payload) => {
        setUser(payload.user)
        localStorage.setItem(STORAGE_USER_KEY, JSON.stringify(payload.user))
      })
      .catch(() => {
        logout()
      })
      .finally(() => {
        setLoading(false)
      })
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

export function useAuth() {
  const context = useContext(AuthContext)

  if (!context) {
    throw new Error('useAuth must be used inside an AuthProvider')
  }

  return context
}
