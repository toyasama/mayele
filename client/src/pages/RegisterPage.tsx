import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/auth'

export function RegisterPage() {
  const { register } = useAuth()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setBusy(true)

    try {
      await register(name, email, password)
      navigate('/dashboard')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Inscription impossible.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="page narrow-page">
      <form className="card form-card" onSubmit={handleSubmit}>
        <span className="eyebrow">Inscription</span>
        <h1>Créer mon espace</h1>
        <p className="muted">Un espace personnel suffit pour enregistrer vos sprints et vos records.</p>

        <label>
          <span>Nom</span>
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Votre prénom"
            minLength={2}
            required
          />
        </label>

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
            placeholder="Au moins 6 caractères"
            minLength={6}
            required
          />
        </label>

        {error ? <p className="form-error">{error}</p> : null}

        <button className="primary-button full-width" type="submit" disabled={busy}>
          {busy ? 'Création...' : 'Créer mon espace'}
        </button>

        <p className="muted centered-text">
          Déjà inscrit ? <Link to="/connexion">Se connecter</Link>
        </p>
      </form>
    </section>
  )
}
