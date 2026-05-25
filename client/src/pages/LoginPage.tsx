import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/auth'

export function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setBusy(true)

    try {
      await login(email, password)
      navigate('/dashboard')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connexion impossible.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="page narrow-page">
      <form className="card form-card" onSubmit={handleSubmit}>
        <span className="eyebrow">Connexion</span>
        <h1>Retrouver mon espace</h1>
        <p className="muted">Connectez-vous pour reprendre vos sprints et suivre vos records.</p>

        <label>
          <span>Email</span>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="exemple@mail.com"
            required
          />
        </label>

        <label>
          <span>Mot de passe</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Votre mot de passe"
            required
          />
        </label>

        {error ? <p className="form-error">{error}</p> : null}

        <button className="primary-button full-width" type="submit" disabled={busy}>
          {busy ? 'Connexion...' : 'Se connecter'}
        </button>

        <p className="muted centered-text">
          Pas encore de compte ? <Link to="/inscription">Créer un espace</Link>
        </p>
      </form>
    </section>
  )
}
