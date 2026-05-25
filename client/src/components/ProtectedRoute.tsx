import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/auth'

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, loading } = useAuth()

  if (loading) {
    return (
      <section className="page narrow-page">
        <div className="card loading-card">Chargement de votre espace...</div>
      </section>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/connexion" replace />
  }

  return <>{children}</>
}
