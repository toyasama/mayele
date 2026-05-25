import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { api, type DashboardData } from '../lib/api'

const GAME_LABELS: Record<string, string> = {
  addition: 'Addition',
  soustraction: 'Soustraction',
  multiplication: 'Multiplication',
}

function formatDate(value: string | null) {
  if (!value) {
    return 'Jamais joué'
  }

  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

export function DashboardPage() {
  const { user, token } = useAuth()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!token) {
      return
    }

    setLoading(true)
    api
      .getDashboard(token)
      .then((payload) => {
        setData(payload)
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Impossible de charger le dashboard.')
      })
      .finally(() => {
        setLoading(false)
      })
  }, [token])

  if (loading) {
    return (
      <section className="page">
        <div className="card loading-card">Chargement de vos statistiques…</div>
      </section>
    )
  }

  if (error) {
    return (
      <section className="page">
        <div className="card form-error">{error}</div>
      </section>
    )
  }

  return (
    <section className="page">
      <div className="card dashboard-hero">
        <div>
          <span className="eyebrow">Dashboard joueur</span>
          <h1>Bonjour {user?.name}</h1>
          <p className="lead small-lead">
            Suivez vos performances et relancez une session à tout moment.
          </p>
        </div>

        <div className="button-row">
          <Link className="primary-button" to="/jeu">
            Lancer un défi
          </Link>
          <Link className="secondary-button" to="/">
            Retour accueil
          </Link>
        </div>
      </div>

      <div className="stats-grid">
        <article className="card stat-card">
          <span>Parties jouées</span>
          <strong>{data?.summary.totalGames ?? 0}</strong>
        </article>
        <article className="card stat-card">
          <span>Meilleur score</span>
          <strong>{data?.summary.bestScore ?? 0}%</strong>
        </article>
        <article className="card stat-card">
          <span>Points cumulés</span>
          <strong>{data?.summary.totalPoints ?? 0}</strong>
        </article>
        <article className="card stat-card">
          <span>Thèmes maîtrisés</span>
          <strong>{data?.summary.masteredTopics ?? 0}</strong>
        </article>
      </div>

      <div className="grid two-columns">
        <article className="card">
          <h2>Progression par thème</h2>
          {data?.progressByGame.length ? (
            <div className="progress-list">
              {data.progressByGame.map((item) => (
                <div className="progress-row" key={item.game}>
                  <div>
                    <strong>{GAME_LABELS[item.game] ?? item.game}</strong>
                    <span>{item.attempts} tentative(s)</span>
                  </div>
                  <div className="progress-meta">
                    <span>Best {item.bestScore}%</span>
                    <span>Moy. {item.averageScore}%</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">Aucune session encore enregistrée. Lancez votre premier jeu.</p>
          )}
        </article>

        <article className="card">
          <h2>Prochaines extensions</h2>
          <ul className="check-list">
            <li>Fractions et pourcentages</li>
            <li>Mode progression par niveau</li>
            <li>Matrices et calcul avancé</li>
            <li>Intégrales guidées</li>
          </ul>
        </article>
      </div>

      <article className="card">
        <h2>Historique récent</h2>
        {data?.recentSessions.length ? (
          <div className="session-list">
            {data.recentSessions.map((session) => (
              <div className="session-row" key={session.id}>
                <div>
                  <strong>{GAME_LABELS[session.game] ?? session.game}</strong>
                  <span>{session.correctAnswers}/{session.totalQuestions} bonnes réponses</span>
                </div>
                <div className="progress-meta right-align">
                  <span>{session.score}%</span>
                  <span>{formatDate(session.playedAt)}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">Votre historique apparaîtra ici après vos premières parties.</p>
        )}
      </article>
    </section>
  )
}
