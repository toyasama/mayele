import { SignUp } from '@clerk/react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/auth'

export function RegisterPage() {
  const { isAuthenticated, loading } = useAuth()

  if (!loading && isAuthenticated) {
    return <Navigate replace to="/dashboard" />
  }

  return (
    <section className="page narrow-page">
      <div className="card form-card auth-card">
        <span className="eyebrow">Inscription</span>
        <h1>Créer mon espace</h1>
        <p className="muted">Un espace personnel suffit pour enregistrer vos sprints et vos records.</p>
        <SignUp
          routing="path"
          path="/inscription"
          signInUrl="/connexion"
          forceRedirectUrl="/dashboard"
          fallbackRedirectUrl="/dashboard"
        />
      </div>
    </section>
  )
}
