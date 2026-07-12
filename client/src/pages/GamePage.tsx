import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ChallengeArenaScreen, ChallengeSetupScreen, type ChallengeMetric } from '../components/ChallengeExperience'
import { ActionBar } from '../components/layout/ActionBar'
import { PageFrame } from '../components/layout/PageFrame'
import { PlayModeNavigationDialog } from '../components/PlayModeNavigationDialog'
import { PlayModeTabs, type PlayModePath } from '../components/PlayModeTabs'
import { useAuth } from '../context/auth'
import { clearCachePrefix, DASHBOARD_CACHE_PREFIX } from '../lib/appCache'
import { api } from '../lib/api'
import { parseAnswerInput } from '../lib/answerInput'
import { LEVEL_RUN_LABELS } from '../lib/challengeLabels'
import {
  MAX_TEMPO_QUESTION_COUNT,
  MAX_TEMPO_QUESTION_SECONDS,
  MIN_TEMPO_QUESTION_COUNT,
  MIN_TEMPO_QUESTION_SECONDS,
  SPRINT_DURATION_SECONDS_OPTIONS,
  type ChallengeMode,
} from '../lib/challengeConfig'
import { criticalRemainingSeconds, isCriticalRemainingTime } from '../lib/challengeTiming'
import {
  GAME_LABELS,
  LEVEL_LABELS,
  SKILL_LABELS,
  calculateElapsedSessionSeconds,
  calculateRemainingSessionSeconds,
  generateQuestion,
  generateUniqueQuestion,
  questionIdentity,
  type AnswerResult,
  type GameLevel,
  type GameType,
  type Question,
  type SkillTag,
} from '../lib/game'
import {
  DEFAULT_SOLO_CHALLENGE_CONFIG,
  activeTimerSecondsForSoloConfig,
  createSoloSessionState,
  isSoloTempoComplete,
  normalizeSoloChallengeConfig,
  recordSoloAnswer,
  totalSecondsForSoloConfig,
  type SoloChallengeConfig,
  type SoloSessionState,
  type SoloSessionStats,
} from '../lib/soloChallenge'

type SessionStatus = 'idle' | 'running' | 'finished'
type FeedbackTone = 'info' | 'success' | 'error'
type AnswerFeedback = {
  prompt: string
  userAnswer: number | null
  correctAnswer: number
  isCorrect: boolean
  streak: number
  source: 'manual' | 'timeout'
}

const SOLO_MODE_LABELS: Record<ChallengeMode, string> = {
  sprint: 'Sprint',
  tempo: 'Tempo',
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

function buildInitialConfig(game: GameType, level: GameLevel, focusSkill: SkillTag | null): SoloChallengeConfig {
  return normalizeSoloChallengeConfig({
    ...DEFAULT_SOLO_CHALLENGE_CONFIG,
    game,
    level,
    focusSkill,
  })
}

function modeEyebrow(config: SoloChallengeConfig) {
  if (config.mode === 'tempo') {
    return `Tempo - ${config.tempoQuestionSeconds}s/question`
  }

  return `Sprint - ${config.sprintDurationSeconds}s`
}

export function GamePage() {
  const { getToken, isAuthenticated } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const initialFocusSkill = parseFocusSkill(searchParams.get('focus'))
  const initialGame = parseGameType(searchParams.get('game'))
  const initialLevel = parseGameLevel(searchParams.get('level'))
  const initialConfig = buildInitialConfig(initialGame, initialLevel, initialFocusSkill)

  const [config, setConfig] = useState<SoloChallengeConfig>(initialConfig)
  const [sessionState, setSessionState] = useState<SoloSessionState>(() => createSoloSessionState(initialConfig))
  const [question, setQuestion] = useState<Question>(() => generateQuestion(initialConfig.game, initialConfig.level, initialConfig.focusSkill))
  const [answer, setAnswer] = useState('')
  const [remainingSeconds, setRemainingSeconds] = useState(activeTimerSecondsForSoloConfig(initialConfig))
  const [status, setStatus] = useState<SessionStatus>('idle')
  const [feedback, setFeedback] = useState(initialFocusSkill ? `Session ciblee sur ${SKILL_LABELS[initialFocusSkill]}.` : '')
  const [feedbackTone, setFeedbackTone] = useState<FeedbackTone>('info')
  const [answerFeedback, setAnswerFeedback] = useState<AnswerFeedback | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [pendingModePath, setPendingModePath] = useState<PlayModePath | null>(null)

  const inputRef = useRef<HTMLInputElement | null>(null)
  const intervalRef = useRef<number | null>(null)
  const timeoutRef = useRef<number | null>(null)
  const countdownTokenRef = useRef(0)
  const activeEndsAtRef = useRef(Date.now() + activeTimerSecondsForSoloConfig(initialConfig) * 1000)
  const expireActiveTimerRef = useRef<() => void>(() => undefined)
  const startedAtRef = useRef(Date.now())
  const questionStartedAtRef = useRef(Date.now())
  const finishedRef = useRef(true)
  const submittedTempoQuestionIndexesRef = useRef(new Set<number>())
  const questionKeysRef = useRef(new Set<string>())
  const statusRef = useRef<SessionStatus>('idle')
  const configRef = useRef<SoloChallengeConfig>(initialConfig)
  const sessionStateRef = useRef<SoloSessionState>(createSoloSessionState(initialConfig))
  const questionRef = useRef<Question>(question)
  const answerRef = useRef('')

  statusRef.current = status
  configRef.current = config
  sessionStateRef.current = sessionState
  questionRef.current = question
  answerRef.current = answer

  const clearTimers = useCallback(() => {
    countdownTokenRef.current += 1

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
    async (finalConfig: SoloChallengeConfig, finalStats: SoloSessionStats, finalAnswers: AnswerResult[], durationSeconds: number) => {
      if (!isAuthenticated || finalStats.totalQuestions === 0) {
        return
      }

      setSaving(true)
      setSaveError('')

      try {
        await api.saveSession(getToken, {
          game: finalConfig.game,
          level: finalConfig.level,
          practiceSkill: finalConfig.focusSkill,
          totalQuestions: finalStats.totalQuestions,
          durationSeconds,
          bestStreak: finalStats.bestStreak,
          answers: finalAnswers,
        })
        clearCachePrefix(DASHBOARD_CACHE_PREFIX)
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : 'Sauvegarde impossible.')
      } finally {
        setSaving(false)
      }
    },
    [getToken, isAuthenticated],
  )

  const finishSession = useCallback(() => {
    if (finishedRef.current) {
      return
    }

    finishedRef.current = true
    clearTimers()
    const finalConfig = configRef.current
    const finalState = sessionStateRef.current
    const durationSeconds = Math.min(
      calculateElapsedSessionSeconds(startedAtRef.current),
      totalSecondsForSoloConfig(finalConfig),
    )
    const modeLabel = SOLO_MODE_LABELS[finalConfig.mode]

    setRemainingSeconds(0)
    setStatus('finished')
    setFeedback(
      finalState.stats.totalQuestions > 0
        ? `${modeLabel} termine. Analyse tes erreurs avant de rejouer.`
        : `${modeLabel} termine sans reponse validee.`,
    )
    setFeedbackTone('info')
    void saveSession(finalConfig, finalState.stats, finalState.answers, durationSeconds)
  }, [clearTimers, saveSession])

  const armCountdown = useCallback(
    (totalSeconds: number, onExpire: () => void) => {
      clearTimers()
      const token = countdownTokenRef.current + 1
      countdownTokenRef.current = token
      const deadline = Date.now() + Math.max(1, totalSeconds) * 1000
      let expired = false

      const expire = () => {
        if (expired || countdownTokenRef.current !== token) {
          return
        }

        expired = true
        onExpire()
      }

      activeEndsAtRef.current = deadline
      expireActiveTimerRef.current = expire
      setRemainingSeconds(Math.max(1, totalSeconds))

      intervalRef.current = window.setInterval(() => {
        const nextRemainingSeconds = calculateRemainingSessionSeconds(deadline)
        setRemainingSeconds(nextRemainingSeconds)

        if (nextRemainingSeconds <= 0) {
          expire()
        }
      }, 250)
      timeoutRef.current = window.setTimeout(expire, Math.max(1, totalSeconds) * 1000 + 80)
    },
    [clearTimers],
  )

  useEffect(() => clearTimers, [clearTimers])

  useEffect(() => {
    if (status === 'running') {
      inputRef.current?.focus()
    }
  }, [question, status])

  useEffect(() => {
    if (status !== 'running') {
      setPendingModePath(null)
    }
  }, [status])

  useEffect(() => {
    function syncRemainingSeconds() {
      if (statusRef.current !== 'running') {
        return
      }

      const nextRemainingSeconds = calculateRemainingSessionSeconds(activeEndsAtRef.current)
      setRemainingSeconds(nextRemainingSeconds)

      if (nextRemainingSeconds <= 0) {
        expireActiveTimerRef.current()
      }
    }

    window.addEventListener('focus', syncRemainingSeconds)
    document.addEventListener('visibilitychange', syncRemainingSeconds)

    return () => {
      window.removeEventListener('focus', syncRemainingSeconds)
      document.removeEventListener('visibilitychange', syncRemainingSeconds)
    }
  }, [])

  function generateForConfig(nextConfig = configRef.current) {
    const generatedQuestion = generateUniqueQuestion(
      nextConfig.game,
      nextConfig.level,
      nextConfig.focusSkill,
      questionKeysRef.current,
    )

    questionKeysRef.current.add(questionIdentity(generatedQuestion))
    questionStartedAtRef.current = Date.now()
    return generatedQuestion
  }

  function resetSession(nextConfigInput: SoloChallengeConfig) {
    const nextConfig = normalizeSoloChallengeConfig(nextConfigInput)
    const nextState = createSoloSessionState(nextConfig)

    clearTimers()
    finishedRef.current = true
    submittedTempoQuestionIndexesRef.current.clear()
    questionKeysRef.current.clear()
    configRef.current = nextConfig
    sessionStateRef.current = nextState
    setConfig(nextConfig)
    setSessionState(nextState)
    setQuestion(generateForConfig(nextConfig))
    setAnswer('')
    setRemainingSeconds(activeTimerSecondsForSoloConfig(nextConfig))
    setStatus('idle')
    setFeedback(nextConfig.focusSkill ? `Session ciblee sur ${SKILL_LABELS[nextConfig.focusSkill]}.` : '')
    setFeedbackTone('info')
    setAnswerFeedback(null)
    setSaveError('')
  }

  function updateConfig(patch: Partial<SoloChallengeConfig>) {
    resetSession({
      ...configRef.current,
      ...patch,
    })
  }

  function startSession() {
    const nextConfig = normalizeSoloChallengeConfig(configRef.current)
    const nextState = createSoloSessionState(nextConfig)
    const startedAt = Date.now()

    startedAtRef.current = startedAt
    finishedRef.current = false
    submittedTempoQuestionIndexesRef.current.clear()
    questionKeysRef.current.clear()
    configRef.current = nextConfig
    sessionStateRef.current = nextState
    const generatedQuestion = generateForConfig(nextConfig)
    setConfig(nextConfig)
    setSessionState(nextState)
    setQuestion(generatedQuestion)
    setAnswer('')
    setRemainingSeconds(activeTimerSecondsForSoloConfig(nextConfig))
    setStatus('running')
    setFeedback('')
    setFeedbackTone('info')
    setAnswerFeedback(null)
    setSaveError('')
    window.scrollTo({ top: 0 })

    if (nextConfig.mode === 'tempo') {
      armCountdown(nextConfig.tempoQuestionSeconds, () => recordCurrentAnswer('timeout'))
      return
    }

    armCountdown(nextConfig.sprintDurationSeconds, finishSession)
  }

  function goToModeHome(path: PlayModePath) {
    setPendingModePath(null)

    if (path === '/jeu/solo') {
      resetSession(DEFAULT_SOLO_CHALLENGE_CONFIG)
      navigate('/jeu/solo', { replace: true })
      window.scrollTo({ top: 0 })
      return
    }

    navigate(path)
  }

  function handleSelectPlayMode(path: PlayModePath) {
    if (status === 'running') {
      setPendingModePath(path)
      return false
    }

    goToModeHome(path)
    return false
  }

  function confirmPendingModeChange() {
    if (pendingModePath) {
      goToModeHome(pendingModePath)
    }
  }

  function recordCurrentAnswer(source: AnswerFeedback['source']) {
    if (statusRef.current !== 'running') {
      return
    }

    const currentConfig = configRef.current
    const currentQuestion = questionRef.current
    const currentState = sessionStateRef.current
    const numericAnswer = parseAnswerInput(answerRef.current)

    if (source === 'manual' && numericAnswer === null) {
      setFeedback('Entre un nombre valide.')
      setFeedbackTone('error')
      setAnswerFeedback(null)
      return
    }

    if (currentConfig.mode === 'tempo') {
      const currentQuestionIndex = currentState.activeQuestionIndex

      if (submittedTempoQuestionIndexesRef.current.has(currentQuestionIndex)) {
        return
      }

      submittedTempoQuestionIndexesRef.current.add(currentQuestionIndex)
    }

    const responseTimeMs = Math.max(0, Date.now() - questionStartedAtRef.current)
    const nextState = recordSoloAnswer(currentState, {
      question: currentQuestion,
      userAnswer: numericAnswer,
      responseTimeMs,
    })
    const answerResult = nextState.answers.at(-1)

    if (!answerResult) {
      return
    }

    sessionStateRef.current = nextState
    setSessionState(nextState)
    setFeedback(source === 'timeout' ? 'Temps ecoule.' : '')
    setFeedbackTone(answerResult.isCorrect ? 'success' : 'error')
    setAnswerFeedback({
      prompt: answerResult.prompt,
      userAnswer: answerResult.userAnswer,
      correctAnswer: answerResult.correctAnswer,
      isCorrect: answerResult.isCorrect,
      streak: nextState.stats.currentStreak,
      source,
    })

    if (currentConfig.mode === 'tempo' && isSoloTempoComplete(nextState)) {
      finishSession()
      return
    }

    const generatedQuestion = generateForConfig(currentConfig)
    setQuestion(generatedQuestion)
    setAnswer('')

    if (currentConfig.mode === 'tempo') {
      armCountdown(currentConfig.tempoQuestionSeconds, () => recordCurrentAnswer('timeout'))
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    recordCurrentAnswer('manual')
  }

  const stats = sessionState.stats
  const modeLabel = SOLO_MODE_LABELS[config.mode]
  const subjectLabel = config.focusSkill ? SKILL_LABELS[config.focusSkill] : GAME_LABELS[config.game]
  const sessionLabel = `${modeLabel} - ${subjectLabel} - ${LEVEL_LABELS[config.level]}`
  const activeTimerTotalSeconds = activeTimerSecondsForSoloConfig(config)
  const elapsedSeconds = Math.max(0, activeTimerTotalSeconds - remainingSeconds)
  const sessionProgress = Math.min(100, Math.max(0, (elapsedSeconds / activeTimerTotalSeconds) * 100))
  const accuracy = stats.totalQuestions ? Math.round((stats.correctAnswers / stats.totalQuestions) * 100) : 0
  const timerCritical = status === 'running' && isCriticalRemainingTime(activeTimerTotalSeconds, remainingSeconds)
  const statsCards: ChallengeMetric[] = [
    { label: 'Score', value: stats.scorePoints },
    { label: 'Serie', value: stats.currentStreak },
    { label: 'Precision', value: `${accuracy}%` },
  ]
  const tempoQuestionProgressLabel = config.mode === 'tempo'
    ? `Question ${Math.min(sessionState.activeQuestionIndex + 1, config.tempoQuestionCount)}/${config.tempoQuestionCount}`
    : undefined

  const setupModeSlot = (
    <div className="challenge-choice-section challenge-config-row challenge-config-mode solo-mode-section">
      <strong>Mode</strong>
      <div className="segmented-grid challenge-mode-grid">
        {(['sprint', 'tempo'] as ChallengeMode[]).map((mode) => (
          <button
            key={mode}
            type="button"
            className={`segment ${config.mode === mode ? 'active' : ''}`}
            aria-pressed={config.mode === mode}
            onClick={() => updateConfig({ mode })}
          >
            {SOLO_MODE_LABELS[mode]}
          </button>
        ))}
      </div>
    </div>
  )

  const setupOptionsSlot = (
    <>
      {config.focusSkill ? (
        <div className="focus-note">
          <span>Entrainement cible</span>
          <strong>{SKILL_LABELS[config.focusSkill]}</strong>
          <button
            type="button"
            className="secondary-button full-width"
            onClick={() => updateConfig({ game: 'mixte', focusSkill: null })}
          >
            Revenir au mixte
          </button>
        </div>
      ) : null}

      <div className="challenge-choice-section challenge-config-rules solo-rules-section">
        <strong>Regles</strong>
        <div className="solo-rule-panel">
          {config.mode === 'tempo' ? (
            <>
              <label>
                Questions
                <input
                  type="number"
                  min={MIN_TEMPO_QUESTION_COUNT}
                  max={MAX_TEMPO_QUESTION_COUNT}
                  aria-label="Questions Tempo"
                  value={config.tempoQuestionCount}
                  onChange={(event) => {
                    const nextValue = event.currentTarget.valueAsNumber
                    updateConfig({
                      tempoQuestionCount: Number.isFinite(nextValue) ? nextValue : configRef.current.tempoQuestionCount,
                    })
                  }}
                />
              </label>
              <label>
                Temps par question
                <input
                  type="number"
                  min={MIN_TEMPO_QUESTION_SECONDS}
                  max={MAX_TEMPO_QUESTION_SECONDS}
                  aria-label="Temps par question Tempo"
                  value={config.tempoQuestionSeconds}
                  onChange={(event) => {
                    const nextValue = event.currentTarget.valueAsNumber
                    updateConfig({
                      tempoQuestionSeconds: Number.isFinite(nextValue) ? nextValue : configRef.current.tempoQuestionSeconds,
                    })
                  }}
                />
              </label>
            </>
          ) : (
            <label>
              Duree
              <select
                aria-label="Duree Sprint"
                value={config.sprintDurationSeconds}
                onChange={(event) => updateConfig({ sprintDurationSeconds: Number(event.currentTarget.value) as SoloChallengeConfig['sprintDurationSeconds'] })}
              >
                {SPRINT_DURATION_SECONDS_OPTIONS.map((seconds) => (
                  <option key={seconds} value={seconds}>
                    {seconds} secondes
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>
    </>
  )

  const feedbackSlot = saveError ? (
    <div className="answer-feedback error">
      <strong>Erreur</strong>
      <span>{saveError}</span>
    </div>
  ) : answerFeedback ? (
    <div className={`answer-feedback ${answerFeedback.isCorrect ? 'success' : 'error'}`}>
      <div>
        <strong>
          {answerFeedback.source === 'timeout' ? 'Temps ecoule' : answerFeedback.isCorrect ? 'Juste' : 'A reprendre'}
        </strong>
        <span>{answerFeedback.prompt}</span>
      </div>
      <div className="answer-values">
        <span>
          Votre reponse <strong>{answerFeedback.userAnswer === null ? 'Aucune' : answerFeedback.userAnswer}</strong>
        </span>
        <span>
          Reponse attendue <strong>{answerFeedback.correctAnswer}</strong>
        </span>
        {answerFeedback.isCorrect ? (
          <span>
            Serie <strong>x{answerFeedback.streak}</strong>
          </span>
        ) : null}
      </div>
    </div>
  ) : feedback ? (
    <div className={`answer-feedback ${feedbackTone === 'error' ? 'error' : 'neutral'}`}>
      <strong>{feedbackTone === 'error' ? 'A corriger' : modeLabel}</strong>
      <span>{feedback}</span>
    </div>
  ) : saving ? (
    <p className="muted">Enregistrement en cours...</p>
  ) : null

  return (
    <PageFrame className={`game-page sprint-${status} solo-${status} ${config.mode}-${status} ${status === 'running' ? 'session-active' : ''} ${timerCritical ? 'timer-critical' : ''}`}>
      <PlayModeTabs onSelectMode={handleSelectPlayMode} />
      {pendingModePath ? (
        <PlayModeNavigationDialog
          targetPath={pendingModePath}
          onCancel={() => setPendingModePath(null)}
          onConfirm={confirmPendingModeChange}
        />
      ) : null}

      {status === 'idle' ? (
        <ChallengeSetupScreen
          eyebrow={modeEyebrow(config)}
          title={modeLabel}
          game={config.focusSkill ? null : config.game}
          level={config.level}
          startLabel={config.mode === 'tempo' ? 'Commencer le tempo' : 'Commencer le sprint'}
          beforeChoicesSlot={setupModeSlot}
          extraSlot={setupOptionsSlot}
          onSelectGame={(nextGame) => updateConfig({ game: nextGame, focusSkill: null })}
          onSelectLevel={(nextLevel) => updateConfig({ level: nextLevel })}
          onStart={startSession}
        />
      ) : status === 'running' ? (
        <ChallengeArenaScreen
          answer={answer}
          answerInputRef={inputRef}
          answerPulse={answerFeedback ? (answerFeedback.isCorrect ? 'correct' : 'wrong') : ''}
          contextLabel={`${modeLabel} - ${LEVEL_RUN_LABELS[config.level]}`}
          elapsedLabel={`${elapsedSeconds}/${activeTimerTotalSeconds}`}
          feedbackSlot={feedbackSlot}
          metrics={statsCards}
          modeLabel="Solo"
          onAnswerChange={setAnswer}
          onExit={finishSession}
          onSubmit={handleSubmit}
          progressPercent={sessionProgress}
          question={question.prompt}
          questionProgressLabel={tempoQuestionProgressLabel}
          criticalRemainingSeconds={criticalRemainingSeconds(activeTimerTotalSeconds)}
          remainingSeconds={remainingSeconds}
        />
      ) : null}

      {status === 'finished' ? (
        <article className="card sprint-card">
          <div className="sprint-topline">
            <span className="eyebrow">{sessionLabel}</span>
            <div className="score-block">
              <strong>+{stats.xp} xp</strong>
            </div>
          </div>

          <div className="result-panel">
            <div className="result-grid">
              <div>
                <strong>{stats.scorePoints} </strong>
                <span>Score</span>
              </div>
              <div>
                <strong>{stats.bestStreak}</strong>
                <span>Serie</span>
              </div>
              <div>
                <strong>{accuracy}%</strong>
                <span>Precision</span>
              </div>
            </div>

            <ActionBar className="sprint-result-actions">
              <button className="challenge-start-button sprint-result-replay" type="button" onClick={startSession}>
                <span>{config.mode === 'tempo' ? 'Rejouer le tempo' : 'Rejouer le sprint'}</span>
              </button>
              <button className="challenge-start-button sprint-result-menu" type="button" onClick={() => goToModeHome('/jeu/solo')}>
                <span>Menu</span>
              </button>
            </ActionBar>
          </div>
        </article>
      ) : null}
    </PageFrame>
  )
}
