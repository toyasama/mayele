import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'

type GameType = 'addition' | 'soustraction' | 'multiplication'

type Question = {
  prompt: string
  answer: number
}

const TOTAL_QUESTIONS = 10
const GAME_LABELS: Record<GameType, string> = {
  addition: 'Addition',
  soustraction: 'Soustraction',
  multiplication: 'Multiplication',
}

function randomBetween(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function generateQuestion(game: GameType): Question {
  if (game === 'addition') {
    const left = randomBetween(8, 60)
    const right = randomBetween(4, 40)
    return { prompt: `${left} + ${right}`, answer: left + right }
  }

  if (game === 'soustraction') {
    const left = randomBetween(15, 90)
    const right = randomBetween(3, left)
    return { prompt: `${left} - ${right}`, answer: left - right }
  }

  const left = randomBetween(2, 12)
  const right = randomBetween(2, 12)
  return { prompt: `${left} × ${right}`, answer: left * right }
}

export function GamePage() {
  const { token } = useAuth()
  const [game, setGame] = useState<GameType>('addition')
  const [question, setQuestion] = useState<Question>(() => generateQuestion('addition'))
  const [answer, setAnswer] = useState('')
  const [step, setStep] = useState(1)
  const [correctCount, setCorrectCount] = useState(0)
  const [feedback, setFeedback] = useState('Répondez à 10 questions pour enregistrer votre session.')
  const [finished, setFinished] = useState(false)
  const [saving, setSaving] = useState(false)
  const [summary, setSummary] = useState<{ score: number; durationSeconds: number } | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const startedAtRef = useRef<number>(Date.now())

  useEffect(() => {
    inputRef.current?.focus()
  }, [question, finished])

  function resetSession(nextGame: GameType = game) {
    setGame(nextGame)
    setQuestion(generateQuestion(nextGame))
    setAnswer('')
    setStep(1)
    setCorrectCount(0)
    setFinished(false)
    setSaving(false)
    setSummary(null)
    setFeedback('Répondez à 10 questions pour enregistrer votre session.')
    startedAtRef.current = Date.now()
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const numericAnswer = Number(answer)
    if (Number.isNaN(numericAnswer)) {
      setFeedback('Entrez un nombre valide pour continuer.')
      return
    }

    const isCorrect = numericAnswer === question.answer
    const nextCorrectCount = correctCount + (isCorrect ? 1 : 0)

    if (step === TOTAL_QUESTIONS) {
      const durationSeconds = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000))
      const score = Math.round((nextCorrectCount / TOTAL_QUESTIONS) * 100)

      setCorrectCount(nextCorrectCount)
      setFinished(true)
      setSummary({ score, durationSeconds })
      setFeedback(
        isCorrect
          ? 'Dernière réponse validée. Sauvegarde de la session…'
          : `Session terminée — la bonne réponse était ${question.answer}.`,
      )

      if (token) {
        try {
          setSaving(true)
          await api.saveSession(token, {
            game,
            score,
            correctAnswers: nextCorrectCount,
            totalQuestions: TOTAL_QUESTIONS,
            durationSeconds,
          })
          setFeedback('Session enregistrée avec succès ✅')
        } catch (err) {
          setFeedback(err instanceof Error ? err.message : 'Sauvegarde impossible.')
        } finally {
          setSaving(false)
        }
      }

      return
    }

    setCorrectCount(nextCorrectCount)
    setStep((current) => current + 1)
    setQuestion(generateQuestion(game))
    setAnswer('')
    setFeedback(isCorrect ? 'Bonne réponse, continuez !' : `Réponse attendue : ${question.answer}`)
  }

  return (
    <section className="page">
      <div className="grid two-columns game-layout">
        <aside className="card">
          <span className="eyebrow">Choix du défi</span>
          <h2>Mode de jeu</h2>
          <div className="mode-list">
            {(Object.keys(GAME_LABELS) as GameType[]).map((item) => (
              <button
                key={item}
                type="button"
                className={item === game ? 'mode-button active' : 'mode-button'}
                onClick={() => resetSession(item)}
              >
                {GAME_LABELS[item]}
              </button>
            ))}
          </div>

          <div className="card subtle-card">
            <strong>Objectif</strong>
            <p>Obtenir le meilleur pourcentage possible sur 10 questions.</p>
          </div>

          <Link className="secondary-button full-width" to="/dashboard">
            Retour au dashboard
          </Link>
        </aside>

        <article className="card quiz-card">
          <div className="quiz-header">
            <div>
              <span className="eyebrow">{GAME_LABELS[game]}</span>
              <h1>Question {finished ? TOTAL_QUESTIONS : step}</h1>
            </div>
            <span className="score-pill">{correctCount} / {TOTAL_QUESTIONS}</span>
          </div>

          {!finished ? (
            <>
              <p className="question-line">{question.prompt} = ?</p>
              <form className="quiz-form" onSubmit={handleSubmit}>
                <input
                  ref={inputRef}
                  type="number"
                  inputMode="numeric"
                  value={answer}
                  onChange={(event) => setAnswer(event.target.value)}
                  placeholder="Votre réponse"
                  required
                />
                <button className="primary-button" type="submit">
                  Valider
                </button>
              </form>
            </>
          ) : (
            <div className="result-panel">
              <h2>Session terminée</h2>
              <p>
                Score final : <strong>{summary?.score ?? 0}%</strong>
              </p>
              <p>
                Temps total : <strong>{summary?.durationSeconds ?? 0} s</strong>
              </p>
              <div className="button-row">
                <button className="primary-button" type="button" onClick={() => resetSession()}>
                  Rejouer
                </button>
                <Link className="secondary-button" to="/dashboard">
                  Voir la progression
                </Link>
              </div>
            </div>
          )}

          <p className={feedback.includes('impossible') ? 'form-error' : 'muted'}>{feedback}</p>
          {saving ? <p className="muted">Enregistrement en cours…</p> : null}
        </article>
      </div>
    </section>
  )
}
