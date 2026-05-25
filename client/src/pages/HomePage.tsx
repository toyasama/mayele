import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const featureCards = [
  {
    title: 'Calcul mental rapide',
    description: 'Addition, soustraction et multiplication dans un mode chrono simple et motivant.',
  },
  {
    title: 'Suivi de progression',
    description: 'Chaque partie alimente votre tableau de bord personnel avec scores et historique.',
  },
  {
    title: 'Évolution future',
    description: 'La base est prête pour accueillir plus tard les matrices, dérivées et intégrales.',
  },
]

export function HomePage() {
  const { isAuthenticated } = useAuth()

  return (
    <section className="page">
      <div className="hero-panel card">
        <div className="hero-copy">
          <span className="eyebrow">Plateforme d’entraînement mathématique</span>
          <h1>Mayele Maths</h1>
          <p className="lead">
            Un site moderne, rapide et responsive pour jouer, réviser et suivre vos progrès sur PC
            comme sur téléphone.
          </p>

          <div className="button-row">
            <Link className="primary-button" to={isAuthenticated ? '/dashboard' : '/inscription'}>
              {isAuthenticated ? 'Ouvrir le dashboard' : 'Créer mon compte'}
            </Link>
            <Link className="secondary-button" to={isAuthenticated ? '/jeu' : '/connexion'}>
              {isAuthenticated ? 'Jouer maintenant' : 'Se connecter'}
            </Link>
          </div>
        </div>

        <div className="hero-stats">
          <div className="metric-card">
            <strong>3</strong>
            <span>modes de jeu prêts</span>
          </div>
          <div className="metric-card">
            <strong>100%</strong>
            <span>responsive</span>
          </div>
          <div className="metric-card">
            <strong>SQLite</strong>
            <span>base locale intégrée</span>
          </div>
        </div>
      </div>

      <div className="grid three-columns">
        {featureCards.map((item) => (
          <article className="card feature-card" key={item.title}>
            <h2>{item.title}</h2>
            <p>{item.description}</p>
          </article>
        ))}
      </div>

      <div className="grid two-columns">
        <article className="card">
          <h2>Parcours prévu</h2>
          <ul className="check-list">
            <li>Calcul mental chronométré</li>
            <li>Multiplications et quiz de rapidité</li>
            <li>Progression par thème et niveau</li>
            <li>Ouverture future vers matrices et intégrales</li>
          </ul>
        </article>

        <article className="card accent-card">
          <h2>Pourquoi cette base ?</h2>
          <p>
            `React + Vite` garantit une interface fluide, tandis que l’authentification et la base
            locale permettent un vrai suivi utilisateur dès le départ.
          </p>
        </article>
      </div>
    </section>
  )
}
