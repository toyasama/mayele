import { type FormEvent, type KeyboardEvent, type ReactNode, type Ref } from 'react'
import { normalizeAnswerInput } from '../lib/answerInput'
import { SPRINT_SESSION_SECONDS, criticalRemainingSeconds as criticalSecondsForTotal } from '../lib/challengeTiming'
import { GAME_LABELS, LEVEL_LABELS, type GameLevel, type GameType } from '../lib/game'

const GAME_SIGNS: Record<GameType, string> = {
  addition: '+',
  soustraction: '-',
  multiplication: 'x',
  division: '/',
  mixte: '+/-',
}

const LEVEL_POWER: Record<GameLevel, number> = {
  debutant: 1,
  intermediaire: 2,
  avance: 3,
  expert: 4,
}

export type ChallengeMetric = {
  label: string
  value: string | number
}

type ChoiceGridProps<T extends string> = {
  disabled?: boolean
  value: T | null
  onSelect: (value: T) => void
}

type ChallengeSetupScreenProps = {
  eyebrow: string
  title: string
  game: GameType | null
  level: GameLevel | null
  startLabel: string
  beforeChoicesSlot?: ReactNode
  extraSlot?: ReactNode
  onSelectGame: (game: GameType) => void
  onSelectLevel: (level: GameLevel) => void
  onStart: () => void
}

type ChallengeArenaScreenProps = {
  answer: string
  answerDisabled?: boolean
  answerInputRef?: Ref<HTMLInputElement>
  answerPulse?: 'correct' | 'wrong' | ''
  contextLabel: string
  elapsedLabel: string
  exitDisabled?: boolean
  exitLabel?: string
  feedbackSlot?: ReactNode
  metrics: ChallengeMetric[]
  modeLabel: string
  onAnswerChange: (value: string) => void
  onExit?: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  progressPercent: number
  question: string
  questionProgressLabel?: string
  criticalRemainingSeconds?: number
  remainingSeconds: number
}

export function OperationChoiceGrid({ disabled = false, value, onSelect }: ChoiceGridProps<GameType>) {
  return (
    <div className="challenge-choice-grid challenge-operation-grid">
      {(Object.keys(GAME_LABELS) as GameType[]).map((game) => (
        <button
          key={game}
          type="button"
          className={`challenge-choice-tile ${value === game ? 'active' : ''}`}
          disabled={disabled}
          onClick={() => onSelect(game)}
        >
          <span className="challenge-choice-symbol" aria-hidden="true">{GAME_SIGNS[game]}</span>
          <span>{GAME_LABELS[game]}</span>
        </button>
      ))}
    </div>
  )
}

export function DifficultyChoiceGrid({ disabled = false, value, onSelect }: ChoiceGridProps<GameLevel>) {
  return (
    <div className="challenge-choice-grid challenge-level-grid">
      {(Object.keys(LEVEL_LABELS) as GameLevel[]).map((level) => (
        <button
          key={level}
          type="button"
          className={`challenge-choice-tile challenge-level-tile ${value === level ? 'active' : ''}`}
          disabled={disabled}
          onClick={() => onSelect(level)}
        >
          <span className="challenge-level-dots" aria-hidden="true">
            {Array.from({ length: 4 }).map((_, index) => (
              <span key={index} className={index < LEVEL_POWER[level] ? 'filled' : ''} />
            ))}
          </span>
          <span>{LEVEL_LABELS[level]}</span>
        </button>
      ))}
    </div>
  )
}

export function ChallengeSetupScreen({
  eyebrow,
  title,
  game,
  level,
  startLabel,
  beforeChoicesSlot,
  extraSlot,
  onSelectGame,
  onSelectLevel,
  onStart,
}: ChallengeSetupScreenProps) {
  return (
    <div className="challenge-setup">
      <header className="challenge-hero">
        <span>{eyebrow}</span>
        <h1>{title}</h1>
      </header>

      <section className="challenge-loadout challenge-config-board" aria-label="Preparation du defi">
        {beforeChoicesSlot}

        <div className="challenge-choice-section challenge-config-row challenge-config-operation">
          <strong>Operation</strong>
          <OperationChoiceGrid value={game} onSelect={onSelectGame} />
        </div>

        <div className="challenge-choice-section challenge-config-row challenge-config-level">
          <strong>Niveau</strong>
          <DifficultyChoiceGrid value={level} onSelect={onSelectLevel} />
        </div>

        {extraSlot}

        <button className="challenge-start-button" type="button" onClick={onStart}>
          <span>{startLabel}</span>
          <span aria-hidden="true">-&gt;</span>
        </button>
      </section>
    </div>
  )
}

export function ChallengeArenaScreen({
  answer,
  answerDisabled = false,
  answerInputRef,
  answerPulse = '',
  contextLabel,
  elapsedLabel,
  exitDisabled = false,
  exitLabel = 'Quitter',
  feedbackSlot,
  metrics,
  modeLabel,
  onAnswerChange,
  onExit,
  onSubmit,
  progressPercent,
  question,
  questionProgressLabel,
  criticalRemainingSeconds = criticalSecondsForTotal(SPRINT_SESSION_SECONDS),
  remainingSeconds,
}: ChallengeArenaScreenProps) {
  const safeProgressPercent = Math.min(100, Math.max(0, progressPercent))
  const critical = remainingSeconds <= criticalRemainingSeconds
  const submitAnswerFromKeyboard = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing || answerDisabled) {
      return
    }

    event.preventDefault()
    event.currentTarget.form?.requestSubmit()
  }

  return (
    <section className={`challenge-arena ${critical ? 'is-critical' : ''} ${answerPulse ? `is-${answerPulse}` : ''}`}>
      <header className="challenge-run-meta">
        {onExit ? (
          <button type="button" disabled={exitDisabled} onClick={onExit}>
            &larr; {exitLabel}
          </button>
        ) : <span />}
        <span className="challenge-run-context">
          <span>{contextLabel}</span>
          {questionProgressLabel ? <small>{questionProgressLabel}</small> : null}
        </span>
        <strong>{modeLabel}</strong>
      </header>

      <div className="challenge-clock" aria-label="Temps restant">
        <strong>{remainingSeconds}</strong>
        <span>s</span>
      </div>

      <div className="challenge-progress">
        <span aria-hidden="true">
          <i style={{ width: `${safeProgressPercent}%` }} />
        </span>
        <strong>{elapsedLabel}</strong>
      </div>

      <div className="challenge-metrics">
        {metrics.map((metric) => (
          <div key={metric.label}>
            <strong>{metric.value}</strong>
            <span>{metric.label}</span>
          </div>
        ))}
      </div>

      <div className="challenge-question-zone">
        <p className="question-line" key={question}>{question}</p>
        <form className="challenge-answer-form" onSubmit={onSubmit}>
          <label>
            <span>Votre reponse</span>
            <input
              ref={answerInputRef}
              type="text"
              value={answer}
              aria-label="Votre reponse"
              aria-keyshortcuts="Enter"
              inputMode="numeric"
              enterKeyHint="enter"
              pattern="[0-9-]*"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              readOnly={answerDisabled}
              aria-disabled={answerDisabled}
              onChange={(event) => onAnswerChange(normalizeAnswerInput(event.currentTarget.value))}
              onKeyDown={submitAnswerFromKeyboard}
              placeholder="?"
              required={!answerDisabled}
            />
          </label>
          <button type="submit" disabled={answerDisabled}>{answerDisabled ? 'En attente' : 'Valider'}</button>
        </form>
      </div>

      {feedbackSlot ? <div className="challenge-feedback-slot">{feedbackSlot}</div> : null}
    </section>
  )
}
