import { SignIn } from '@clerk/react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/auth'

export function LoginPage() {
  const { isAuthenticated, loading } = useAuth()

  if (!loading && isAuthenticated) {
    return <Navigate replace to="/dashboard" />
  }

  return (
    <section className="page narrow-page">
      <div className="card form-card auth-card">
        <span className="eyebrow">Connexion</span>
        <h1>Retrouver mon espace</h1>
        <p className="muted">Connectez-vous pour reprendre vos sprints et suivre vos records.</p>
        <SignIn
          routing="path"
          path="/connexion"
          signUpUrl="/inscription"
          forceRedirectUrl="/dashboard"
          fallbackRedirectUrl="/dashboard"
        />
      </div>
    </section>
  )
}
