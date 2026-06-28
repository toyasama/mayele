import { useSignIn } from '@clerk/react'
import { type FormEvent, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/auth'
import { clerkErrorMessage } from '../lib/clerkErrors'

export function LoginPage() {
  const { isAuthenticated, loading } = useAuth()
  const { fetchStatus, signIn } = useSignIn()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const clerkBusy = fetchStatus === 'fetching'
  const canSubmit = !clerkBusy && !submitting && email.trim().length > 3 && password.length > 0

  if (!loading && isAuthenticated) {
    return <Navigate replace to="/dashboard" />
  }

  async function finalizeSignIn() {
    const { error: finalizeError } = await signIn.finalize({
      navigate: ({ decorateUrl }) => {
        const destination = decorateUrl('/dashboard')

        if (destination.startsWith('http')) {
          window.location.href = destination
          return
        }

        navigate(destination)
      },
    })

    if (finalizeError) {
      setError(clerkErrorMessage(finalizeError, 'Connexion impossible.'))
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    setSubmitting(true)
    setError('')

    try {
      const { error: passwordError } = await signIn.password({
        emailAddress: email.trim(),
        password,
      })

      if (passwordError) {
        setError(clerkErrorMessage(passwordError, 'Connexion impossible.'))
        return
      }

      if (signIn.status === 'complete') {
        await finalizeSignIn()
        return
      }

      setError('Connexion incomplète. Utilisez email et mot de passe pour le moment.')
    } catch (caughtError) {
      setError(clerkErrorMessage(caughtError, 'Connexion impossible.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="page narrow-page">
      <div className="card form-card auth-card">
        <span className="eyebrow">Connexion</span>
        <h1>Retrouver mon espace</h1>
        <p className="muted">Connectez-vous avec votre email et votre mot de passe.</p>

        <form className="stacked-form" onSubmit={handleSubmit}>
          <label>
            Email
            <input
              autoComplete="email"
              type="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value)
                setError('')
              }}
              placeholder="vous@exemple.com"
            />
          </label>

          <label>
            Mot de passe
            <input
              autoComplete="current-password"
              type="password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value)
                setError('')
              }}
              placeholder="Votre mot de passe"
            />
          </label>

          {error ? <div className="form-error">{error}</div> : null}

          <button className="primary-button full-width" type="submit" disabled={!canSubmit}>
            {submitting ? 'Connexion...' : 'Se connecter'}
          </button>
        </form>

        <p className="muted centered-text">
          Pas encore de compte ? <Link className="inline-link" to="/inscription">Créez votre espace</Link>
        </p>
      </div>
    </section>
  )
}
