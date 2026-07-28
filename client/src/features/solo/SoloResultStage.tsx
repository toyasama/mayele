import type { CSSProperties } from 'react'
import type { AnswerResult, SkillTag } from '../../lib/game'
import type { SoloSessionStats } from '../../lib/soloChallenge'

type SoloResultStageProps = {
  accuracy: number
  answers: AnswerResult[]
  modeLabel: string
  sessionLabel: string
  stats: SoloSessionStats
  skillLabel: (skill: SkillTag) => string
  onReplay: () => void
  onReturn: () => void
}

function resultTone(accuracy: number) {
  if (accuracy >= 75) return 'solid'
  if (accuracy >= 50) return 'progress'
  if (accuracy >= 25) return 'fragile'
  return 'restart'
}

function resultTitle(accuracy: number, hasAnswers: boolean) {
  if (!hasAnswers) return 'Partie terminée.'
  if (accuracy >= 90) return 'Excellent résultat !'
  if (accuracy >= 75) return 'Bien joué !'
  if (accuracy >= 50) return 'Tu progresses.'
  return 'Encore un essai.'
}

function mostMissedSkill(answers: AnswerResult[]) {
  const mistakes = new Map<SkillTag, number>()

  for (const answer of answers) {
    if (!answer.isCorrect) {
      mistakes.set(answer.skill, (mistakes.get(answer.skill) ?? 0) + 1)
    }
  }

  return [...mistakes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}

function averageResponseTime(answers: AnswerResult[]) {
  if (!answers.length) return null
  return Math.round(answers.reduce((total, answer) => total + answer.responseTimeMs, 0) / answers.length)
}

function formatDuration(milliseconds: number | null) {
  if (milliseconds === null) return '—'
  if (milliseconds < 1_000) return `${milliseconds} ms`
  return `${(milliseconds / 1_000).toFixed(1)} s`
}

export function SoloResultStage({
  accuracy,
  answers,
  modeLabel,
  sessionLabel,
  stats,
  skillLabel,
  onReplay,
  onReturn,
}: SoloResultStageProps) {
  const missedSkill = mostMissedSkill(answers)
  const averageTime = averageResponseTime(answers)
  const tone = resultTone(accuracy)
  const hasAnswers = answers.length > 0

  return (
    <article className={`solo-result-stage result-${tone}`} aria-labelledby="solo-result-title">
      <header className="solo-result-heading">
        <div>
          <span className="eyebrow">{sessionLabel}</span>
          <h1 id="solo-result-title">{resultTitle(accuracy, hasAnswers)}</h1>
        </div>
        <span className="solo-result-xp">+{stats.xp} XP</span>
      </header>

      <div className="solo-result-summary">
        <div className="solo-result-score" style={{ '--solo-result-progress': `${accuracy * 3.6}deg` } as CSSProperties}>
          <div>
            <strong>{accuracy}%</strong>
            <span>de réponses justes</span>
          </div>
        </div>

        <dl className="solo-result-metrics">
          <div>
            <dt>Bonnes réponses</dt>
            <dd>{stats.correctAnswers}/{stats.totalQuestions}</dd>
          </div>
          <div>
            <dt>Meilleure série</dt>
            <dd>{stats.bestStreak}</dd>
          </div>
          <div>
            <dt>Temps moyen</dt>
            <dd>{formatDuration(averageTime)}</dd>
          </div>
          <div>
            <dt>Points</dt>
            <dd>{stats.scorePoints}</dd>
          </div>
        </dl>

        <aside className="solo-result-next">
          <span>{!hasAnswers ? 'Partie terminée' : missedSkill ? 'À retravailler' : 'Sans faute'}</span>
          <strong>
            {!hasAnswers
              ? 'Aucune réponse enregistrée'
              : missedSkill
                ? skillLabel(missedSkill)
                : 'Toutes les réponses sont justes'}
          </strong>
          <p>
            {!hasAnswers
              ? 'Relance une partie quand tu es prêt.'
              : missedSkill
              ? `Rejoue ce ${modeLabel.toLowerCase()} pour consolider ce point.`
              : 'Passe au niveau suivant ou tente un autre mode.'}
          </p>
        </aside>
      </div>

      <div className="solo-result-actions">
        <button className="primary-button" type="button" onClick={onReplay}>
          Rejouer
        </button>
        <button className="secondary-button" type="button" onClick={onReturn}>
          Changer de partie
        </button>
      </div>
    </article>
  )
}
