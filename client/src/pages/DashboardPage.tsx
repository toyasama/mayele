import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/auth'
import { api, type DashboardData } from '../lib/api'
import { GAME_LABELS, LEVEL_LABELS, SKILL_LABELS, type GameLevel, type GameType, type SkillTag } from '../lib/game'

function formatDate(value: string | null) {
  if (!value) {
    return 'Pas encore joué'
  }

  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function gameLabel(value: string) {
  return GAME_LABELS[value as GameType] ?? value
}

function levelLabel(value: string | null) {
  if (!value) {
    return 'Débutant'
  }

  return LEVEL_LABELS[value as GameLevel] ?? value
}

function skillLabel(value: SkillTag | null) {
  if (!value) {
    return 'Aucune compétence ciblée'
  }

  return SKILL_LABELS[value] ?? value
}

export function DashboardPage() {
  const { user, token } = useAuth()
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!token) {
      return
    }

    let active = true

    api
      .getDashboard(token)
      .then((payload) => {
        if (active) {
          setData(payload)
        }
      })
      .catch((err) => {
        if (active) {
          setError(err instanceof Error ? err.message : 'Impossible de charger votre espace.')
        }
      })

    return () => {
      active = false
    }
  }, [token])

  if (error) {
    return (
      <section className="page">
        <div className="card form-error">{error}</div>
      </section>
    )
  }

  if (!data) {
    return (
      <section className="page">
        <div className="card loading-card">Chargement de vos résultats...</div>
      </section>
    )
  }

  const dailyProgress = Math.min(100, Math.round((data.summary.todaySessions / data.summary.dailyGoal) * 100))
  const practiceLink = data.practicePlan.recommendedSkill
    ? `/jeu?focus=${data.practicePlan.recommendedSkill}`
    : '/jeu'

  return (
    <section className="page">
      <div className="dashboard-hero">
        <div>
          <span className="eyebrow">Mon espace</span>
          <h1>Bonjour {user?.name}</h1>
          <p className="lead small-lead">
            Suivez vos records, vos compétences et les points à retravailler au prochain sprint.
          </p>
        </div>

        <div className="button-row">
          <Link className="primary-button" to={practiceLink}>
            Travailler mes erreurs
          </Link>
          <Link className="secondary-button" to="/jeu">
            Sprint libre
          </Link>
        </div>
      </div>

      <div className="stats-grid">
        <article className="card stat-card">
          <span>Sessions</span>
          <strong>{data.summary.totalSessions}</strong>
        </article>
        <article className="card stat-card">
          <span>Record</span>
          <strong>{data.summary.bestScore}%</strong>
        </article>
        <article className="card stat-card">
          <span>Précision moyenne</span>
          <strong>{data.summary.averageAccuracy}%</strong>
        </article>
        <article className="card stat-card">
          <span>Meilleure série</span>
          <strong>{data.summary.bestStreak}</strong>
        </article>
      </div>

      <div className="grid two-columns">
        <article className="card diagnostic-card">
          <h2>À travailler</h2>
          <p className="muted">{data.practicePlan.message}</p>
          {data.weakSkills.length ? (
            <div className="skill-list">
              {data.weakSkills.map((item) => (
                <div className="skill-row" key={item.skill}>
                  <div>
                    <strong>{skillLabel(item.skill)}</strong>
                    <span>{item.correctAnswers}/{item.attempts} bonnes réponses</span>
                  </div>
                  <span>{item.accuracy}%</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">Faites quelques sprints pour obtenir un diagnostic fiable.</p>
          )}
          <Link className="primary-button full-width" to={practiceLink}>
            Lancer l’entraînement ciblé
          </Link>
        </article>

        <article className="card diagnostic-card">
          <h2>Objectif du jour</h2>
          <div className="goal-meter">
            <div>
              <strong>{data.summary.todaySessions}/{data.summary.dailyGoal}</strong>
              <span>sprints aujourd’hui</span>
            </div>
            <div className="goal-bar" aria-hidden="true">
              <span style={{ width: `${dailyProgress}%` }} />
            </div>
          </div>
          <div className="badge-list">
            {data.achievements.length ? (
              data.achievements.slice(0, 4).map((achievement) => (
                <div className="badge-chip" key={achievement.key}>
                  <strong>{achievement.label}</strong>
                  <span>{achievement.description}</span>
                </div>
              ))
            ) : (
              <p className="muted">Vos premiers badges apparaîtront après les prochains sprints.</p>
            )}
          </div>
        </article>
      </div>

      <div className="grid two-columns">
        <article className="card">
          <h2>Progression par entraînement</h2>
          {data.progressByMode.length ? (
            <div className="progress-list">
              {data.progressByMode.map((item) => (
                <div className="progress-row" key={`${item.game}-${item.level}`}>
                  <div>
                    <strong>{gameLabel(item.game)}</strong>
                    <span>{levelLabel(item.level)} · {item.attempts} sprint(s)</span>
                  </div>
                  <div className="progress-meta">
                    <span>Record {item.bestScore}%</span>
                    <span>Moy. {item.averageScore}%</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">Aucun sprint enregistré. Lancez votre première session.</p>
          )}
        </article>

        <article className="card">
          <h2>Repères</h2>
          <div className="insight-list">
            <div>
              <span>Points gagnés</span>
              <strong>{data.summary.totalPoints}</strong>
            </div>
            <div>
              <span>Dernière activité</span>
              <strong>{formatDate(data.summary.lastPlayedAt)}</strong>
            </div>
            <div>
              <span>Mode le plus joué</span>
              <strong>{data.summary.favoriteGame ? gameLabel(data.summary.favoriteGame) : 'À découvrir'}</strong>
            </div>
            <div>
              <span>Compétence proposée</span>
              <strong>{skillLabel(data.practicePlan.recommendedSkill)}</strong>
            </div>
          </div>
        </article>
      </div>

      <article className="card">
        <h2>Historique récent</h2>
        {data.recentSessions.length ? (
          <div className="session-list">
            {data.recentSessions.map((session) => (
              <div className="session-row" key={session.id}>
                <div>
                  <strong>{gameLabel(session.game)} · {levelLabel(session.level)}</strong>
                  <span>
                    {session.correctAnswers}/{session.totalQuestions} bonnes réponses · série {session.bestStreak}
                    {session.practiceSkill ? ` · ${skillLabel(session.practiceSkill)}` : ''}
                  </span>
                </div>
                <div className="progress-meta right-align">
                  <span>{session.score}% · {session.points} pts</span>
                  <span>{formatDate(session.playedAt)}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">Vos sprints apparaîtront ici après vos premières parties.</p>
        )}
      </article>
    </section>
  )
}
