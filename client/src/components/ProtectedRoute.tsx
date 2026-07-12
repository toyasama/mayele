import { type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/auth'
import { useProfile } from '../context/profile-context'

export function ProtectedRoute({ children, requireCompleteProfile = true }: { children: ReactNode; requireCompleteProfile?: boolean }) {
  const { isAuthenticated, loading } = useAuth()
  const { profile, profileLoading, profileError, refreshProfile } = useProfile()

  if (loading) {
    return (
      <section className="page narrow-page">
        <div className="card loading-card">Chargement de votre profil...</div>
      </section>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/connexion" replace />
  }

  if (requireCompleteProfile && !profile) {
    if (profileError && !profileLoading) {
      return (
        <section className="page narrow-page">
          <div className="card loading-card">
            <p>{profileError}</p>
            <button className="ghost-button" type="button" onClick={() => void refreshProfile()}>
              Reessayer
            </button>
          </div>
        </section>
      )
    }

    return (
      <section className="page narrow-page">
        <div className="card loading-card">Chargement de votre profil...</div>
      </section>
    )
  }

  if (requireCompleteProfile && profile && !profile.profileComplete) {
    return <Navigate to="/profil/configuration" replace />
  }

  return <>{children}</>
}
