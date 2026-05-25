import { Link } from 'react-router-dom'
import { useAuth } from '../context/auth'

const habits = [
  {
    title: 'Un sprint court',
    description: '60 secondes pour se concentrer, répondre vite et garder le rythme.',
  },
  {
    title: 'Un niveau adapté',
    description: 'Débutant, intermédiaire, avancé ou expert selon l’objectif du moment.',
  },
  {
    title: 'Des résultats lisibles',
    description: 'Record, précision et séries aident à savoir quoi améliorer au prochain essai.',
  },
]

export function HomePage() {
  const { isAuthenticated } = useAuth()

  return (
    <section className="page">
      <div className="hero-panel">
        <div className="hero-copy">
          <span className="eyebrow">Entraînement mental</span>
          <h1>Mayele Maths</h1>
          <p className="lead">
            Lancez un sprint, trouvez le bon rythme et progressez à chaque session. L’objectif est
            simple: plus de bonnes réponses, moins d’hésitation.
          </p>

          <div className="button-row">
            <Link className="primary-button" to={isAuthenticated ? '/jeu' : '/inscription'}>
              {isAuthenticated ? 'Lancer un sprint' : 'Créer mon espace'}
            </Link>
            <Link className="secondary-button" to={isAuthenticated ? '/dashboard' : '/connexion'}>
              {isAuthenticated ? 'Voir mes résultats' : 'Reprendre une session'}
            </Link>
          </div>
        </div>

        <div className="hero-stats">
          <div className="metric-card">
            <strong>60s</strong>
            <span>par sprint</span>
          </div>
          <div className="metric-card">
            <strong>5</strong>
            <span>modes d’entraînement</span>
          </div>
          <div className="metric-card">
            <strong>4</strong>
            <span>niveaux de difficulté</span>
          </div>
        </div>
      </div>

      <div className="grid three-columns">
        {habits.map((item) => (
          <article className="card feature-card" key={item.title}>
            <h2>{item.title}</h2>
            <p>{item.description}</p>
          </article>
        ))}
      </div>

      <div className="focus-band">
        <div>
          <span className="eyebrow">Aujourd’hui</span>
          <h2>Choisissez un mode, battez votre série, recommencez.</h2>
        </div>
        <Link className="primary-button" to={isAuthenticated ? '/jeu' : '/inscription'}>
          Commencer
        </Link>
      </div>
    </section>
  )
}
