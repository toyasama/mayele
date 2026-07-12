import { Link } from 'react-router-dom'
import { useAuth } from '../context/auth'

export function HomePage() {
  const { isAuthenticated } = useAuth()

  const primaryTarget = isAuthenticated ? '/jeu' : '/connexion'
  const secondaryTarget = isAuthenticated ? '/dashboard' : '/inscription'

  return (
    <section className="page home-page">
      <div className="home-hero">
        <div className="home-hero-copy">
          <h1>
            Calculez vite. Progressez à chaque <span>sprint.</span>
          </h1>
          <p className="lead">
            Choisis un mode, réponds en 60 secondes, puis retrouve tes résultats, tes séries, tes missions et tes badges dans ton espace.
          </p>
          <div className="button-row">
            <Link className="primary-button" to={primaryTarget}>
              {isAuthenticated ? 'Commencer à jouer' : 'Se connecter'}
            </Link>
            <Link className="secondary-button" to={secondaryTarget}>
              {isAuthenticated ? 'Voir mon espace' : 'Créer un compte'}
            </Link>
          </div>
        </div>

        <div className="arena-preview home-sprint-preview" aria-label="Aperçu d’une session Mayele">
          <span className="quick-test-badge">Essai rapide</span>
          <div className="arena-topline">
            <span>Session mixte</span>
            <strong>00:37</strong>
          </div>
          <div className="arena-question">
            <span>6 × 7</span>
          </div>
          <div className="arena-answer-preview">Tape ta réponse...</div>
          <button className="primary-button arena-submit-preview" type="button" tabIndex={-1}>
            Valider
          </button>
          <div className="arena-lanes">
            <div>
              <span>Série</span>
              <strong>0</strong>
            </div>
            <div>
              <span>Précision</span>
              <strong>92%</strong>
            </div>
            <div>
              <span>XP</span>
              <strong>420</strong>
            </div>
          </div>
          <div className="arena-feedback">
            <span>À retravailler</span>
            <strong>Division rapide</strong>
          </div>
        </div>
      </div>
    </section>
  )
}
