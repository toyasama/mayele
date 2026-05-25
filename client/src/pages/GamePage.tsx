import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/auth'
import {
  GAME_LABELS,
  LEVEL_LABELS,
  SESSION_SECONDS,
  calculateAccuracy,
  calculateQuestionPoints,
  generateQuestion,
  type GameLevel,
  type GameType,
  type Question,
} from '../lib/game'
import { api } from '../lib/api'

type SessionStatus = 'idle' | 'running' | 'finished'
type FeedbackTone = 'info' | 'success' | 'error'

type SessionStats = {
  correctAnswers: number
  totalQuestions: number
  points: number
  currentStreak: number
  bestStreak: number
}

const initialStats: SessionStats = {
  correctAnswers: 0,
  totalQuestions: 0,
  points: 0,
  currentStreak: 0,
  bestStreak: 0,
}

export function GamePage() {
  const { token } = useAuth()
  const [game, setGame] = useState<GameType>('mixte')
  const [level, setLevel] = useState<GameLevel>('debutant')
  const [question, setQuestion] = useState<Question>(() => generateQuestion('mixte', 'debutant'))
  const [answer, setAnswer] = useState('')
  const [remainingSeconds, setRemainingSeconds] = useState(SESSION_SECONDS)
  const [status, setStatus] = useState<SessionStatus>('idle')
  const [stats, setStats] = useState<SessionStats>(initialStats)
  const [feedback, setFeedback] = useState('Choisissez un mode, lancez le sprint, puis répondez le plus vite possible.')
  const [feedbackTone, setFeedbackTone] = useState<FeedbackTone>('info')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)
  const intervalRef = useRef<number | null>(null)
  const timeoutRef = useRef<number | null>(null)
  const startedAtRef = useRef<number>(Date.now())
  const statsRef = useRef<SessionStats>(initialStats)
  const gameRef = useRef<GameType>(game)
  const levelRef = useRef<GameLevel>(level)

  statsRef.current = stats
  gameRef.current = game
  levelRef.current = level

  const clearTimers = useCallback(() => {
    if (intervalRef.current) {
      window.clearInterval(intervalRef.current)
      intervalRef.current = null
    }

    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  const saveSession = useCallback(
    async (finalStats: SessionStats, durationSeconds: number) => {
      if (!token || finalStats.totalQuestions === 0) {
        return
      }

      setSaving(true)
      setSaveError('')

      try {
        await api.saveSession(token, {
          game: gameRef.current,
          level: levelRef.current,
          score: calculateAccuracy(finalStats.correctAnswers, finalStats.totalQuestions),
          points: finalStats.points,
          correctAnswers: finalStats.correctAnswers,
          totalQuestions: finalStats.totalQuestions,
          durationSeconds,
          bestStreak: finalStats.bestStreak,
        })
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : 'Sauvegarde impossible.')
      } finally {
        setSaving(false)
      }
    },
    [token],
  )

  const finishSession = useCallback(() => {
    clearTimers()
    const durationSeconds = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000))
    const finalStats = statsRef.current
    setRemainingSeconds(0)
    setStatus('finished')
    setFeedback(
      finalStats.totalQuestions > 0
        ? 'Sprint terminé. Votre résultat est enregistré dans votre espace.'
        : 'Sprint terminé sans réponse validée.',
    )
    setFeedbackTone('info')
    void saveSession(finalStats, Math.min(durationSeconds, SESSION_SECONDS))
  }, [clearTimers, saveSession])

  useEffect(() => {
    return () => {
      clearTimers()
    }
  }, [clearTimers])

  useEffect(() => {
    if (status === 'running') {
      inputRef.current?.focus()
    }
  }, [question, status])

  function prepareSession(nextGame = game, nextLevel = level) {
    clearTimers()
    setGame(nextGame)
    setLevel(nextLevel)
    setQuestion(generateQuestion(nextGame, nextLevel))
    setAnswer('')
    setRemainingSeconds(SESSION_SECONDS)
    setStatus('idle')
    setStats(initialStats)
    setFeedback('Prêt pour un nouveau sprint de 60 secondes.')
    setFeedbackTone('info')
    setSaveError('')
  }

  function startSession() {
    const nextQuestion = generateQuestion(game, level)
    startedAtRef.current = Date.now()
    setQuestion(nextQuestion)
    setAnswer('')
    setRemainingSeconds(SESSION_SECONDS)
    setStatus('running')
    setStats(initialStats)
    setFeedback('Sprint lancé.')
    setFeedbackTone('info')
    setSaveError('')

    clearTimers()
    intervalRef.current = window.setInterval(() => {
      setRemainingSeconds((current) => Math.max(0, current - 1))
    }, 1000)
    timeoutRef.current = window.setTimeout(finishSession, SESSION_SECONDS * 1000)
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (status !== 'running') {
      return
    }

    const numericAnswer = Number(answer)
    if (!Number.isFinite(numericAnswer)) {
      setFeedback('Entrez un nombre valide.')
      setFeedbackTone('error')
      return
    }

    const isCorrect = numericAnswer === question.answer
    const nextStreakForFeedback = isCorrect ? stats.currentStreak + 1 : 0
    setStats((current) => {
      const nextStreak = isCorrect ? current.currentStreak + 1 : 0
      const nextCorrectAnswers = current.correctAnswers + (isCorrect ? 1 : 0)
      const nextStats = {
        correctAnswers: nextCorrectAnswers,
        totalQuestions: current.totalQuestions + 1,
        points: current.points + (isCorrect ? calculateQuestionPoints(level, nextStreak) : 0),
        currentStreak: nextStreak,
        bestStreak: Math.max(current.bestStreak, nextStreak),
      }

      statsRef.current = nextStats
      return nextStats
    })
    setFeedback(
      isCorrect
        ? `Bonne réponse. Série x${nextStreakForFeedback}.`
        : `Réponse incorrecte. La bonne réponse était ${question.answer}.`,
    )
    setFeedbackTone(isCorrect ? 'success' : 'error')
    setQuestion(generateQuestion(game, level))
    setAnswer('')
  }

  const accuracy = calculateAccuracy(stats.correctAnswers, stats.totalQuestions)

  return (
    <section className="page game-page">
      <div className="section-header">
        <div>
          <span className="eyebrow">Sprint mental</span>
          <h1>Répondez juste, enchaînez vite.</h1>
        </div>
        <Link className="secondary-button" to="/dashboard">
          Mon espace
        </Link>
      </div>

      <div className="game-shell">
        <aside className="card control-panel">
          <div>
            <span className="panel-label">Mode</span>
            <div className="segmented-grid">
              {(Object.keys(GAME_LABELS) as GameType[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  className={item === game ? 'segment active' : 'segment'}
                  disabled={status === 'running'}
                  onClick={() => prepareSession(item, level)}
                >
                  {GAME_LABELS[item]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="panel-label">Niveau</span>
            <div className="segmented-grid">
              {(Object.keys(LEVEL_LABELS) as GameLevel[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  className={item === level ? 'segment active' : 'segment'}
                  disabled={status === 'running'}
                  onClick={() => prepareSession(game, item)}
                >
                  {LEVEL_LABELS[item]}
                </button>
              ))}
            </div>
          </div>

          <div className="mini-stats">
            <div>
              <span>Temps</span>
              <strong>{remainingSeconds}s</strong>
            </div>
            <div>
              <span>Bonnes réponses</span>
              <strong>{stats.correctAnswers}/{stats.totalQuestions}</strong>
            </div>
            <div>
              <span>Série</span>
              <strong>{stats.currentStreak}</strong>
            </div>
            <div>
              <span>Précision</span>
              <strong>{accuracy}%</strong>
            </div>
          </div>
        </aside>

        <article className="card sprint-card">
          <div className="sprint-topline">
            <div>
              <span className="eyebrow">
                {GAME_LABELS[game]} · {LEVEL_LABELS[level]}
              </span>
              <h2>{status === 'finished' ? 'Résultat du sprint' : 'Question active'}</h2>
            </div>
            <div className="score-block">
              <span>Score</span>
              <strong>{stats.points}</strong>
            </div>
          </div>

          {status === 'finished' ? (
            <div className="result-panel">
              <div className="result-grid">
                <div>
                  <span>Bonnes réponses</span>
                  <strong>{stats.correctAnswers}/{stats.totalQuestions}</strong>
                </div>
                <div>
                  <span>Précision</span>
                  <strong>{accuracy}%</strong>
                </div>
                <div>
                  <span>Meilleure série</span>
                  <strong>{stats.bestStreak}</strong>
                </div>
              </div>
              <div className="button-row">
                <button className="primary-button" type="button" onClick={startSession}>
                  Rejouer
                </button>
                <Link className="secondary-button" to="/dashboard">
                  Voir mes résultats
                </Link>
              </div>
            </div>
          ) : (
            <>
              <p className="question-line">{question.prompt}</p>
              <form className="quiz-form" onSubmit={handleSubmit}>
                <input
                  ref={inputRef}
                  type="number"
                  inputMode="numeric"
                  value={answer}
                  disabled={status !== 'running'}
                  onChange={(event) => setAnswer(event.target.value)}
                  placeholder="Réponse"
                  required
                />
                {status === 'idle' ? (
                  <button className="primary-button" type="button" onClick={startSession}>
                    Démarrer
                  </button>
                ) : (
                  <button className="primary-button" type="submit">
                    Valider
                  </button>
                )}
              </form>
            </>
          )}

          <div className={saveError ? 'feedback-banner error' : `feedback-banner ${feedbackTone}`}>
            <strong>{saveError ? 'Erreur' : feedbackTone === 'success' ? 'Correct' : feedbackTone === 'error' ? 'À corriger' : 'Info'}</strong>
            <span>{saveError || feedback}</span>
          </div>
          {saving ? <p className="muted">Enregistrement en cours...</p> : null}
        </article>
      </div>
    </section>
  )
}
