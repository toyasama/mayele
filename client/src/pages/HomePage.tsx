import { Link } from 'react-router-dom'
import { useAuth } from '../context/auth'

const trainingPaths = [
  {
    title: 'Sprint libre',
    meta: 'Jouer maintenant',
    description: 'Une session mixte pour vous échauffer et chercher la meilleure série.',
    to: '/jeu',
  },
  {
    title: 'Rejouer mes erreurs',
    meta: 'Reprendre une erreur',
    description: 'Relancez une série sur les calculs qui vous ont fait perdre des points.',
    to: '/dashboard',
  },
  {
    title: 'Records',
    meta: 'Voir mes résultats',
    description: 'Comparez vos scores, vos séries et vos niveaux après chaque sprint.',
    to: '/dashboard',
  },
]

const progressionLoop = [
  {
    step: '01',
    title: 'Choisir le mode',
    text: 'Addition, soustraction, multiplication, division ou mixte.',
  },
  {
    step: '02',
    title: 'Répondre vite',
    text: 'Chaque bonne réponse augmente la série et le score.',
  },
  {
    step: '03',
    title: 'Corriger les erreurs',
    text: 'Les calculs ratés restent disponibles pour les retravailler.',
  },
]

export function HomePage() {
  const { isAuthenticated } = useAuth()

  const primaryTarget = isAuthenticated ? '/jeu' : '/inscription'
  const secondaryTarget = isAuthenticated ? '/dashboard' : '/connexion'

  return (
    <section className="page home-page">
      <div className="home-hero">
        <div className="home-hero-copy">
          <span className="eyebrow">Mayele Maths</span>
          <h1>Calculez vite. Progressez à chaque sprint.</h1>
          <p className="lead">
            Choisissez un niveau, répondez en 60 secondes, puis retrouvez vos résultats dans votre espace.
          </p>
          <div className="button-row">
            <Link className="primary-button" to={primaryTarget}>
              {isAuthenticated ? 'Lancer une session' : 'Créer mon profil'}
            </Link>
            <Link className="secondary-button" to={secondaryTarget}>
              {isAuthenticated ? 'Voir mes progrès' : 'J’ai déjà un compte'}
            </Link>
          </div>
        </div>

        <div className="arena-preview" aria-label="Aperçu d’une session Mayele">
          <div className="arena-topline">
            <span>Session mixte</span>
            <strong>00:37</strong>
          </div>
          <div className="arena-question">
            <span>48 ÷ 6</span>
            <strong>8</strong>
          </div>
          <div className="arena-lanes">
            <div>
              <span>Série</span>
              <strong>5</strong>
            </div>
            <div>
              <span>Précision</span>
              <strong>86%</strong>
            </div>
            <div>
              <span>Points</span>
              <strong>420</strong>
            </div>
          </div>
          <div className="arena-feedback">
            <span>À retravailler</span>
            <strong>Division rapide</strong>
          </div>
        </div>
      </div>

      <section className="home-section">
        <div className="section-kicker">
          <span className="eyebrow">Modes</span>
          <h2>Choisissez comment commencer.</h2>
        </div>
        <div className="grid three-columns home-path-grid">
          {trainingPaths.map((path) => (
            <Link className="card path-card" key={path.title} to={isAuthenticated ? path.to : '/inscription'}>
              <span>{path.meta}</span>
              <h3>{path.title}</h3>
              <p>{path.description}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="home-section home-loop-section">
        <div className="section-kicker">
          <span className="eyebrow">Progression</span>
          <h2>Une partie simple, des résultats utiles.</h2>
        </div>
        <div className="loop-track">
          {progressionLoop.map((item) => (
            <article className="loop-step" key={item.step}>
              <span>{item.step}</span>
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </article>
          ))}
        </div>
      </section>

    </section>
  )
}
