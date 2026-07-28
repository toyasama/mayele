import { Link } from 'react-router-dom'
import type { DashboardData } from '../../lib/api'
import '../../styles/dashboard-collections-v2.css'

type Session = DashboardData['recentSessions'][number]

type SessionTimelineProps = {
  sessions: Session[]
  expandedSessionId: string | null
  onToggleSession: (sessionId: string) => void
  gameLabel: (game: string) => string
  levelLabel: (level: string | null) => string
  skillLabel: (skill: Session['practiceSkill']) => string
  formatDate: (value: string | null) => string
}

type ScoreBand = {
  className: 'score-critical' | 'score-caution' | 'score-progress' | 'score-strong'
  label: string
}

function getScoreBand(score: number): ScoreBand {
  if (score < 25) return { className: 'score-critical', label: 'À reprendre' }
  if (score < 50) return { className: 'score-caution', label: 'Fragile' }
  if (score < 75) return { className: 'score-progress', label: 'En progrès' }
  return { className: 'score-strong', label: 'Solide' }
}

export function SessionTimeline({ sessions, expandedSessionId, onToggleSession, gameLabel, levelLabel, skillLabel, formatDate }: SessionTimelineProps) {
  const bestScore = sessions.reduce((best, session) => Math.max(best, session.score), 0)
  const totalXp = sessions.reduce((sum, session) => sum + session.xp, 0)

  return (
    <section className="dashboard-history session-timeline" aria-label="Historique des sessions">
      <div className="section-header compact-header timeline-heading">
        <div>
          <span className="eyebrow">Historique</span>
          <h2>Sessions récentes</h2>
          <p>{sessions.length} sprints · +{totalXp} XP</p>
        </div>
        <Link className="secondary-button" to="/jeu">Nouveau sprint</Link>
      </div>

      {sessions.length ? (
        <div className="session-list detailed-session-list timeline-list">
          {sessions.map((session) => {
            const expanded = expandedSessionId === session.id
            const wrongAnswers = session.answers.filter((answer) => !answer.isCorrect).length
            const scoreBand = getScoreBand(session.score)

            return (
              <article className={`session-row detailed-session-row timeline-session ${scoreBand.className} ${session.score === bestScore ? 'is-best' : ''}`} key={session.id}>
                <span className="timeline-node" aria-hidden="true" />
                <div className="timeline-session-main">
                  <span className="timeline-session-kicker">{scoreBand.label}</span>
                  <h3>{gameLabel(session.game)} · {levelLabel(session.level)}</h3>
                  <div className="session-tags">
                    <span>{formatDate(session.playedAt)}</span>
                    <span>{session.correctAnswers}/{session.totalQuestions} bonnes réponses</span>
                    <span>Série {session.bestStreak}</span>
                    {session.practiceSkill ? <span>{skillLabel(session.practiceSkill)}</span> : null}
                  </div>
                </div>
                <div className="timeline-session-score">
                  <strong>{session.score}%</strong>
                  <progress max="100" value={session.score} aria-label={`Score de la session : ${session.score}%`} />
                  <span>+{session.xp} XP</span>
                </div>
                <button className="secondary-button history-answers-button" type="button" aria-expanded={expanded} onClick={() => onToggleSession(session.id)}>
                  {expanded ? 'Masquer' : wrongAnswers ? `${wrongAnswers} erreur${wrongAnswers > 1 ? 's' : ''} à revoir` : 'Voir le détail'}
                </button>
                {expanded ? (
                  <div className="answer-history-panel">
                    {session.answers.length ? (
                      <div className="answer-history-list">
                        {session.answers.map((answer, index) => (
                          <div className={`answer-history-row ${answer.isCorrect ? 'correct' : 'wrong'}`} key={answer.id}>
                            <span className="answer-index">{index + 1}</span>
                            <strong>{answer.prompt}</strong>
                            <span>Votre réponse <b>{answer.userAnswer ?? '—'}</b></span>
                            <span>Attendu <b>{answer.correctAnswer}</b></span>
                            <span>{Math.round(answer.responseTimeMs / 100) / 10}s</span>
                          </div>
                        ))}
                      </div>
                    ) : <p className="muted">Aucune réponse enregistrée pour cette partie.</p>}
                  </div>
                ) : null}
              </article>
            )
          })}
        </div>
      ) : (
        <div className="dashboard-empty-state"><strong>Aucune session enregistrée.</strong><Link className="primary-button" to="/jeu">Lancer un sprint</Link></div>
      )}
    </section>
  )
}
