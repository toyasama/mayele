import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/auth'
import { api } from '../lib/api'
import {
  GAME_LABELS,
  LEVEL_LABELS,
  SESSION_SECONDS,
  SKILL_LABELS,
  calculateAccuracy,
  calculateQuestionPoints,
  generateQuestion,
  summarizeSkillPerformance,
  type AnswerResult,
  type GameLevel,
  type GameType,
  type Question,
  type SkillTag,
} from '../lib/game'

type SessionStatus = 'idle' | 'running' | 'finished'
type FeedbackTone = 'info' | 'success' | 'error'
type AnswerFeedback = {
  prompt: string
  userAnswer: number
  correctAnswer: number
  isCorrect: boolean
  streak: number
}

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

function parseFocusSkill(value: string | null): SkillTag | null {
  if (!value) {
    return null
  }

  return Object.keys(SKILL_LABELS).includes(value) ? (value as SkillTag) : null
}

function parseGameType(value: string | null): GameType {
  return Object.keys(GAME_LABELS).includes(value ?? '') ? (value as GameType) : 'mixte'
}

function parseGameLevel(value: string | null): GameLevel {
  return Object.keys(LEVEL_LABELS).includes(value ?? '') ? (value as GameLevel) : 'debutant'
}

export function GamePage() {
  const { getToken, isAuthenticated } = useAuth()
  const [searchParams] = useSearchParams()
  const initialFocusSkill = parseFocusSkill(searchParams.get('focus'))
  const initialGame = parseGameType(searchParams.get('game'))
  const initialLevel = parseGameLevel(searchParams.get('level'))
  const [game, setGame] = useState<GameType>(initialGame)
  const [level, setLevel] = useState<GameLevel>(initialLevel)
  const [focusSkill, setFocusSkill] = useState<SkillTag | null>(initialFocusSkill)
  const [question, setQuestion] = useState<Question>(() => generateQuestion(initialGame, initialLevel, initialFocusSkill))
  const [answer, setAnswer] = useState('')
  const [remainingSeconds, setRemainingSeconds] = useState(SESSION_SECONDS)
  const [status, setStatus] = useState<SessionStatus>('idle')
  const [stats, setStats] = useState<SessionStats>(initialStats)
  const [answers, setAnswers] = useState<AnswerResult[]>([])
  const [feedback, setFeedback] = useState(
    initialFocusSkill ? `Session ciblée sur ${SKILL_LABELS[initialFocusSkill]}.` : '',
  )
  const [feedbackTone, setFeedbackTone] = useState<FeedbackTone>('info')
  const [answerFeedback, setAnswerFeedback] = useState<AnswerFeedback | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)
  const intervalRef = useRef<number | null>(null)
  const timeoutRef = useRef<number | null>(null)
  const startedAtRef = useRef<number>(Date.now())
  const questionStartedAtRef = useRef<number>(Date.now())
  const statsRef = useRef<SessionStats>(initialStats)
  const answersRef = useRef<AnswerResult[]>([])
  const gameRef = useRef<GameType>(game)
  const levelRef = useRef<GameLevel>(level)
  const focusSkillRef = useRef<SkillTag | null>(focusSkill)

  statsRef.current = stats
  answersRef.current = answers
  gameRef.current = game
  levelRef.current = level
  focusSkillRef.current = focusSkill

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
    async (finalStats: SessionStats, finalAnswers: AnswerResult[], durationSeconds: number) => {
      if (!isAuthenticated || finalStats.totalQuestions === 0) {
        return
      }

      setSaving(true)
      setSaveError('')

      try {
        await api.saveSession(getToken, {
          game: gameRef.current,
          level: levelRef.current,
          practiceSkill: focusSkillRef.current,
          score: calculateAccuracy(finalStats.correctAnswers, finalStats.totalQuestions),
          points: finalStats.points,
          correctAnswers: finalStats.correctAnswers,
          totalQuestions: finalStats.totalQuestions,
          durationSeconds,
          bestStreak: finalStats.bestStreak,
          answers: finalAnswers,
        })
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : 'Sauvegarde impossible.')
      } finally {
        setSaving(false)
      }
    },
    [getToken, isAuthenticated],
  )

  const finishSession = useCallback(() => {
    clearTimers()
    const durationSeconds = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000))
    const finalStats = statsRef.current
    const finalAnswers = answersRef.current
    setRemainingSeconds(0)
    setStatus('finished')
    setFeedback(
      finalStats.totalQuestions > 0
        ? 'Sprint terminé. Analysez vos erreurs avant de rejouer.'
        : 'Sprint terminé sans réponse validée.',
    )
    setFeedbackTone('info')
    void saveSession(finalStats, finalAnswers, Math.min(durationSeconds, SESSION_SECONDS))
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

  function nextQuestion(nextGame = game, nextLevel = level, nextFocusSkill = focusSkill) {
    const generatedQuestion = generateQuestion(nextGame, nextLevel, nextFocusSkill)
    questionStartedAtRef.current = Date.now()
    return generatedQuestion
  }

  function prepareSession(nextGame = game, nextLevel = level, nextFocusSkill: SkillTag | null = focusSkill) {
    clearTimers()
    setGame(nextGame)
    setLevel(nextLevel)
    setFocusSkill(nextFocusSkill)
    setQuestion(nextQuestion(nextGame, nextLevel, nextFocusSkill))
    setAnswer('')
    setRemainingSeconds(SESSION_SECONDS)
    setStatus('idle')
    setStats(initialStats)
    setAnswers([])
    setFeedback(
      nextFocusSkill
        ? `Session ciblée sur ${SKILL_LABELS[nextFocusSkill]}.`
        : '',
    )
    setFeedbackTone('info')
    setAnswerFeedback(null)
    setSaveError('')
  }

  function startSession() {
    const generatedQuestion = nextQuestion(game, level, focusSkill)
    startedAtRef.current = Date.now()
    setQuestion(generatedQuestion)
    setAnswer('')
    setRemainingSeconds(SESSION_SECONDS)
    setStatus('running')
    setStats(initialStats)
    setAnswers([])
    setFeedback('')
    setFeedbackTone('info')
    setAnswerFeedback(null)
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
      setAnswerFeedback(null)
      return
    }

    const isCorrect = numericAnswer === question.answer
    const nextStreakForFeedback = isCorrect ? stats.currentStreak + 1 : 0
    const responseTimeMs = Math.max(0, Date.now() - questionStartedAtRef.current)
    const answerResult: AnswerResult = {
      prompt: question.prompt,
      correctAnswer: question.answer,
      userAnswer: numericAnswer,
      responseTimeMs,
      isCorrect,
      game,
      level,
      skill: question.skill,
    }

    setAnswers((current) => {
      const nextAnswers = [...current, answerResult]
      answersRef.current = nextAnswers
      return nextAnswers
    })
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
    setFeedback('')
    setFeedbackTone(isCorrect ? 'success' : 'error')
    setAnswerFeedback({
      prompt: question.prompt,
      userAnswer: numericAnswer,
      correctAnswer: question.answer,
      isCorrect,
      streak: nextStreakForFeedback,
    })
    setQuestion(nextQuestion(game, level, focusSkill))
    setAnswer('')
  }

  const accuracy = calculateAccuracy(stats.correctAnswers, stats.totalQuestions)
  const skillPerformance = summarizeSkillPerformance(answers)
  const weakSkills = skillPerformance.filter((item) => item.attempts >= 2 && item.accuracy < 70).slice(0, 2)
  const recentErrors = answers.filter((item) => !item.isCorrect).slice(-3).reverse()

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

      <div className="session-banner">
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

      <div className="game-shell">
        <details className="card control-panel settings-panel" open>
          <summary>Réglages du sprint</summary>
          <div>
            <span className="panel-label">Mode</span>
            <div className="segmented-grid">
              {(Object.keys(GAME_LABELS) as GameType[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  className={item === game && !focusSkill ? 'segment active' : 'segment'}
                  disabled={status === 'running'}
                  onClick={() => prepareSession(item, level, null)}
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
                  onClick={() => prepareSession(game, item, focusSkill)}
                >
                  {LEVEL_LABELS[item]}
                </button>
              ))}
            </div>
          </div>

          {focusSkill ? (
            <div className="focus-note">
              <span>Entraînement ciblé</span>
              <strong>{SKILL_LABELS[focusSkill]}</strong>
              <button type="button" className="secondary-button full-width" disabled={status === 'running'} onClick={() => prepareSession('mixte', level, null)}>
                Revenir au mixte
              </button>
            </div>
          ) : null}

          <button className="primary-button full-width start-session-button" type="button" disabled={status === 'running'} onClick={startSession}>
            {status === 'finished' ? 'Rejouer' : status === 'running' ? 'Sprint en cours' : 'Démarrer'}
          </button>
        </details>

        <article className="card sprint-card">
          <div className="sprint-topline">
            <div>
              <span className="eyebrow">
                {focusSkill ? SKILL_LABELS[focusSkill] : GAME_LABELS[game]} · {LEVEL_LABELS[level]}
              </span>
              <h2>{status === 'finished' ? 'Bilan du sprint' : 'Question active'}</h2>
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

              {weakSkills.length ? (
                <div className="diagnostic-box">
                  <h3>À retravailler</h3>
                  <div className="pill-list">
                    {weakSkills.map((item) => (
                      <span className="skill-pill" key={item.skill}>
                        {SKILL_LABELS[item.skill]} · {item.accuracy}%
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              {recentErrors.length ? (
                <div className="error-review">
                  <h3>Dernières erreurs</h3>
                  {recentErrors.map((item) => (
                    <div className="error-row" key={`${item.prompt}-${item.responseTimeMs}`}>
                      <span>{item.prompt}</span>
                      <strong>{item.userAnswer} → {item.correctAnswer}</strong>
                    </div>
                  ))}
                </div>
              ) : null}

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
              <p className="skill-hint">{SKILL_LABELS[question.skill]}</p>
              <form className="quiz-form" onSubmit={handleSubmit}>
                <input
                  ref={inputRef}
                  type="number"
                  inputMode="numeric"
                  value={answer}
                  disabled={status !== 'running'}
                  onChange={(event) => setAnswer(event.target.value)}
                  placeholder={status === 'running' ? 'Réponse' : 'Démarrez le sprint'}
                  required
                />
                <button className="primary-button" type="submit" disabled={status !== 'running'}>
                  Valider
                </button>
              </form>
            </>
          )}

          {saveError ? (
            <div className="answer-feedback error">
              <strong>Erreur</strong>
              <span>{saveError}</span>
            </div>
          ) : answerFeedback ? (
            <div className={`answer-feedback ${answerFeedback.isCorrect ? 'success' : 'error'}`}>
              <div>
                <strong>{answerFeedback.isCorrect ? 'Juste' : 'À reprendre'}</strong>
                <span>{answerFeedback.prompt}</span>
              </div>
              <div className="answer-values">
                <span>
                  Votre réponse <strong>{answerFeedback.userAnswer}</strong>
                </span>
                <span>
                  Réponse attendue <strong>{answerFeedback.correctAnswer}</strong>
                </span>
                {answerFeedback.isCorrect ? (
                  <span>
                    Série <strong>x{answerFeedback.streak}</strong>
                  </span>
                ) : null}
              </div>
            </div>
          ) : feedback ? (
            <div className={`answer-feedback ${feedbackTone === 'error' ? 'error' : 'neutral'}`}>
              <strong>{feedbackTone === 'error' ? 'À corriger' : 'Sprint'}</strong>
              <span>{feedback}</span>
            </div>
          ) : null}
          {saving ? <p className="muted">Enregistrement en cours...</p> : null}
        </article>
      </div>
    </section>
  )
}
