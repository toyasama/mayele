import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ChallengeArenaScreen, ChallengeSetupScreen, type ChallengeMetric } from '../components/ChallengeExperience'
import { PageFrame } from '../components/layout/PageFrame'
import { PlayModeNavigationDialog } from '../components/PlayModeNavigationDialog'
import { PlayModeTabs, type PlayModePath } from '../components/PlayModeTabs'
import { useAuth } from '../context/auth'
import { SoloResultStage } from '../features/solo/SoloResultStage'
import { clearCachePrefix, DASHBOARD_CACHE_PREFIX } from '../lib/appCache'
import { api, type DailyObjective, type SoloRunData, type SoloRunQuestion } from '../lib/api'
import '../styles/routes/game.css'
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
import { createClientCommandId } from '../lib/clientCommandId'
import {
  GAME_LABELS,
  LEVEL_LABELS,
  SKILL_LABELS,
  calculateRemainingSessionSeconds,
  type GameLevel,
  type GameType,
  type SkillTag,
} from '../lib/game'
import {
  DEFAULT_SOLO_CHALLENGE_CONFIG,
  activeTimerSecondsForSoloConfig,
  createSoloSessionState,
  normalizeSoloChallengeConfig,
  type SoloChallengeConfig,
  type SoloSessionState,
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

function configFromRun(run: SoloRunData): SoloChallengeConfig {
  return normalizeSoloChallengeConfig({
    mode: run.mode,
    game: run.game,
    level: run.level,
    focusSkill: run.practiceSkill,
    sprintDurationSeconds: (run.mode === 'sprint' ? run.durationSeconds : 60) as SoloChallengeConfig['sprintDurationSeconds'],
    tempoQuestionCount: run.questionCount,
    tempoQuestionSeconds: run.perQuestionTimeLimitSeconds ?? 10,
  })
}

function stateFromRun(run: SoloRunData): SoloSessionState {
  return {
    config: configFromRun(run),
    stats: run.progress,
    answers: run.answers,
    activeQuestionIndex: run.currentQuestionIndex,
  }
}

export function GamePage() {
  const { getToken, isAuthenticated, user } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const initialFocusSkill = parseFocusSkill(searchParams.get('focus'))
  const initialGame = parseGameType(searchParams.get('game'))
  const initialLevel = parseGameLevel(searchParams.get('level'))
  const initialConfig = buildInitialConfig(initialGame, initialLevel, initialFocusSkill)

  const [config, setConfig] = useState<SoloChallengeConfig>(initialConfig)
  const [sessionState, setSessionState] = useState<SoloSessionState>(() => createSoloSessionState(initialConfig))
  const [question, setQuestion] = useState<SoloRunQuestion | null>(null)
  const [answer, setAnswer] = useState('')
  const [remainingSeconds, setRemainingSeconds] = useState(activeTimerSecondsForSoloConfig(initialConfig))
  const [status, setStatus] = useState<SessionStatus>('idle')
  const [feedback, setFeedback] = useState(initialFocusSkill ? `Session ciblee sur ${SKILL_LABELS[initialFocusSkill]}.` : '')
  const [feedbackTone, setFeedbackTone] = useState<FeedbackTone>('info')
  const [answerFeedback, setAnswerFeedback] = useState<AnswerFeedback | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [pendingModePath, setPendingModePath] = useState<PlayModePath | null>(null)
  const [modeHelpOpen, setModeHelpOpen] = useState(false)
  const [dailyObjectives, setDailyObjectives] = useState<DailyObjective[]>([])
  const [dailyObjectivesLoading, setDailyObjectivesLoading] = useState(true)
  const [expandedObjectiveKey, setExpandedObjectiveKey] = useState<string | null>(null)

  const inputRef = useRef<HTMLInputElement | null>(null)
  const intervalRef = useRef<number | null>(null)
  const timeoutRef = useRef<number | null>(null)
  const countdownTokenRef = useRef(0)
  const activeEndsAtRef = useRef(Date.now() + activeTimerSecondsForSoloConfig(initialConfig) * 1000)
  const expireActiveTimerRef = useRef<() => void>(() => undefined)
  const finishedRef = useRef(true)
  const answerSubmittingRef = useRef(false)
  const startCommandIdRef = useRef<string | null>(null)
  const restoredOwnerRef = useRef<string | null>(null)
  const getTokenRef = useRef(getToken)
  const statusRef = useRef<SessionStatus>('idle')
  const configRef = useRef<SoloChallengeConfig>(initialConfig)
  const sessionStateRef = useRef<SoloSessionState>(createSoloSessionState(initialConfig))
  const runRef = useRef<SoloRunData | null>(null)
  const answerRef = useRef('')

  statusRef.current = status
  configRef.current = config
  sessionStateRef.current = sessionState
  answerRef.current = answer
  getTokenRef.current = getToken

  useEffect(() => {
    if (!modeHelpOpen) return

    const previousOverflow = document.body.style.overflow
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setModeHelpOpen(false)
    }

    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', closeOnEscape)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [modeHelpOpen])

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

  const refreshDailyObjectives = useCallback(async () => {
    if (!isAuthenticated) return

    setDailyObjectivesLoading(true)
    try {
      const { objectives } = await api.getDailyObjectives(getToken)
      setDailyObjectives(objectives)
    } catch {
      // Les objectifs restent une information secondaire : la preparation
      // d'une partie doit rester disponible si leur lecture echoue.
    } finally {
      setDailyObjectivesLoading(false)
    }
  }, [getToken, isAuthenticated])

  const applyServerRun = useCallback((run: SoloRunData) => {
    const nextConfig = configFromRun(run)
    const nextState = stateFromRun(run)
    runRef.current = run
    configRef.current = nextConfig
    sessionStateRef.current = nextState
    finishedRef.current = run.status === 'completed'
    setConfig(nextConfig)
    setSessionState(nextState)
    setQuestion(run.question)
    setAnswer('')

    if (run.status === 'completed') {
      setRemainingSeconds(0)
      setStatus('finished')
      setFeedback(
        run.progress.totalQuestions > 0
          ? `${SOLO_MODE_LABELS[run.mode]} terminé. Analyse tes erreurs avant de rejouer.`
          : `${SOLO_MODE_LABELS[run.mode]} terminé sans réponse validée.`,
      )
      clearCachePrefix(DASHBOARD_CACHE_PREFIX)
      return
    }

    setStatus('running')
    setFeedback('')
  }, [])

  const armCountdownUntil = useCallback(
    (deadlineAt: string, serverNow: string, onExpire: () => void) => {
      clearTimers()
      const token = countdownTokenRef.current + 1
      countdownTokenRef.current = token
      const remainingMs = Math.max(0, Date.parse(deadlineAt) - Date.parse(serverNow))
      const deadline = Date.now() + remainingMs
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
      setRemainingSeconds(Math.max(0, Math.ceil(remainingMs / 1000)))

      intervalRef.current = window.setInterval(() => {
        const nextRemainingSeconds = calculateRemainingSessionSeconds(deadline)
        setRemainingSeconds(nextRemainingSeconds)

        if (nextRemainingSeconds <= 0) {
          expire()
        }
      }, 250)
      timeoutRef.current = window.setTimeout(expire, remainingMs + 80)
    },
    [clearTimers],
  )

  const expireHandlerRef = useRef<() => void>(() => undefined)
  const armRunTimer = useCallback((run: SoloRunData) => {
    const deadlineAt = run.mode === 'tempo' ? run.question?.deadlineAt : run.endsAt
    if (!deadlineAt || run.status !== 'active') return
    armCountdownUntil(deadlineAt, run.serverNow, () => expireHandlerRef.current())
  }, [armCountdownUntil])

  const finishSession = useCallback(async () => {
    const run = runRef.current
    if (!run || finishedRef.current || saving) return

    finishedRef.current = true
    clearTimers()
    setSaving(true)
    setSaveError('')

    try {
      const response = await api.finishSoloRun(getToken, run.id)
      applyServerRun(response.run)
      void refreshDailyObjectives()
      setFeedbackTone('info')
    } catch (error) {
      finishedRef.current = false
      setStatus('finished')
      setRemainingSeconds(0)
      setSaveError(error instanceof Error ? error.message : 'Finalisation impossible.')
    } finally {
      setSaving(false)
    }
  }, [applyServerRun, clearTimers, getToken, refreshDailyObjectives, saving])

  useEffect(() => {
    const ownerId = user?.clerkUserId
    if (!isAuthenticated || !ownerId || restoredOwnerRef.current === ownerId) return
    let cancelled = false

    void refreshDailyObjectives()

    void api.getActiveSoloRun(getTokenRef.current)
      .then(({ run }) => {
        if (cancelled) return
        restoredOwnerRef.current = ownerId
        if (!run) return
        applyServerRun(run)
        armRunTimer(run)
      })
      .catch((error) => {
        if (!cancelled) setSaveError(error instanceof Error ? error.message : 'Reprise de la partie impossible.')
      })

    return () => {
      cancelled = true
    }
  }, [applyServerRun, armRunTimer, isAuthenticated, refreshDailyObjectives, user?.clerkUserId])

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

  function resetSession(nextConfigInput: SoloChallengeConfig) {
    const nextConfig = normalizeSoloChallengeConfig(nextConfigInput)
    const nextState = createSoloSessionState(nextConfig)

    clearTimers()
    finishedRef.current = true
    answerSubmittingRef.current = false
    runRef.current = null
    startCommandIdRef.current = null
    configRef.current = nextConfig
    sessionStateRef.current = nextState
    setConfig(nextConfig)
    setSessionState(nextState)
    setQuestion(null)
    setAnswer('')
    setRemainingSeconds(activeTimerSecondsForSoloConfig(nextConfig))
    setStatus('idle')
    setFeedback(nextConfig.focusSkill ? `Session ciblée sur ${SKILL_LABELS[nextConfig.focusSkill]}.` : '')
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

  async function startSession() {
    if (saving) return
    if (runRef.current && runRef.current.status !== 'completed') {
      setSaveError('Terminez la partie en cours avant d’en commencer une nouvelle.')
      return
    }

    const nextConfig = normalizeSoloChallengeConfig(configRef.current)
    const clientRunId = startCommandIdRef.current ?? createClientCommandId()
    startCommandIdRef.current = clientRunId
    setSaving(true)
    setSaveError('')

    try {
      const { run } = await api.startSoloRun(getToken, {
        clientRunId,
        mode: nextConfig.mode,
        game: nextConfig.game,
        level: nextConfig.level,
        practiceSkill: nextConfig.focusSkill,
        sprintDurationSeconds: nextConfig.sprintDurationSeconds,
        tempoQuestionCount: nextConfig.tempoQuestionCount,
        tempoQuestionSeconds: nextConfig.tempoQuestionSeconds,
      })
      startCommandIdRef.current = null
      setAnswerFeedback(null)
      setFeedbackTone('info')
      applyServerRun(run)
      armRunTimer(run)
      window.scrollTo({ top: 0 })
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Démarrage de la partie impossible.')
    } finally {
      setSaving(false)
    }
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

  async function confirmPendingModeChange() {
    const target = pendingModePath
    if (!target) return
    await finishSession()
    if (runRef.current?.status === 'completed') goToModeHome(target)
  }

  async function recordCurrentAnswer(source: AnswerFeedback['source']) {
    const run = runRef.current
    const currentQuestion = run?.question
    if (statusRef.current !== 'running' || !run || !currentQuestion || answerSubmittingRef.current) return

    const numericAnswer = source === 'timeout' ? null : parseAnswerInput(answerRef.current)

    if (source === 'manual' && numericAnswer === null) {
      setFeedback('Entre un nombre valide.')
      setFeedbackTone('error')
      setAnswerFeedback(null)
      return
    }

    answerSubmittingRef.current = true
    setFeedback(source === 'timeout' ? 'Temps écoulé.' : '')
    setSaveError('')

    try {
      const response = await api.submitSoloAnswer(getToken, run.id, {
        questionIndex: currentQuestion.index,
        userAnswer: numericAnswer,
      })
      applyServerRun(response.run)
      if (response.run.status === 'completed') void refreshDailyObjectives()

      if (response.correction) {
        setFeedbackTone(response.correction.isCorrect ? 'success' : 'error')
        setAnswerFeedback({
          prompt: response.correction.prompt,
          userAnswer: response.correction.userAnswer,
          correctAnswer: response.correction.correctAnswer,
          isCorrect: response.correction.isCorrect,
          streak: response.run.progress.currentStreak,
          source,
        })
      }

      if (response.run.status === 'active') armRunTimer(response.run)
    } catch (error) {
      try {
        const { run: latestRun } = await api.getSoloRun(getToken, run.id)
        const storedCorrection = latestRun.answers.find(
          (storedAnswer) => storedAnswer.questionIndex === currentQuestion.index,
        )

        if (storedCorrection) {
          applyServerRun(latestRun)
          if (latestRun.status === 'completed') void refreshDailyObjectives()
          setFeedbackTone(storedCorrection.isCorrect ? 'success' : 'error')
          setAnswerFeedback({
            prompt: storedCorrection.prompt,
            userAnswer: storedCorrection.userAnswer,
            correctAnswer: storedCorrection.correctAnswer,
            isCorrect: storedCorrection.isCorrect,
            streak: latestRun.progress.currentStreak,
            source,
          })
          if (latestRun.status === 'active') armRunTimer(latestRun)
          return
        }
      } catch {
        // Le message initial est plus utile si la lecture de réconciliation échoue aussi.
      }

      setFeedbackTone('error')
      setSaveError(error instanceof Error ? error.message : 'Réponse non enregistrée.')
    } finally {
      answerSubmittingRef.current = false
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void recordCurrentAnswer('manual')
  }

  expireHandlerRef.current = () => {
    if (runRef.current?.mode === 'tempo') {
      void recordCurrentAnswer('timeout')
      return
    }
    void finishSession()
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
  const completedDailyObjectives = dailyObjectives.filter((objective) => objective.completed || objective.claimed).length
  const expandedDailyObjective = dailyObjectives.find((objective) => objective.key === expandedObjectiveKey) ?? null

  const setupModeSlot = (
    <div className="challenge-choice-section challenge-config-row challenge-config-mode solo-mode-section">
      <div className="solo-mode-label">
        <strong>Mode</strong>
        <button
          type="button"
          className="solo-mode-help-trigger"
          aria-label="Informations sur les modes de jeu"
          aria-haspopup="dialog"
          aria-expanded={modeHelpOpen}
          onClick={() => setModeHelpOpen(true)}
        >
          ?
        </button>
      </div>
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

  const dailyObjectivesPanel = dailyObjectives.length || dailyObjectivesLoading ? (
    <section className="solo-daily-objectives" aria-labelledby="solo-daily-objectives-title">
      <header className="solo-daily-objectives-header">
        <div className="solo-daily-objectives-title">
          <span aria-hidden="true">◎</span>
          <strong id="solo-daily-objectives-title">Objectifs du jour</strong>
        </div>
        <span>{dailyObjectivesLoading && !dailyObjectives.length ? 'Actualisation…' : `${completedDailyObjectives}/${dailyObjectives.length} terminés`}</span>
      </header>

      {dailyObjectives.length ? (
        <div className="solo-daily-objectives-list">
          {dailyObjectives.map((objective, index) => {
            const complete = objective.completed || objective.claimed

            return (
              <button
                type="button"
                className={`solo-daily-objective ${complete ? 'is-complete' : ''} ${expandedObjectiveKey === objective.key ? 'is-expanded' : ''}`}
                key={`${objective.key}-${objective.scopeKey}`}
                aria-expanded={expandedObjectiveKey === objective.key}
                aria-controls={expandedObjectiveKey === objective.key ? 'solo-daily-objective-detail' : undefined}
                onClick={() => setExpandedObjectiveKey((current) => current === objective.key ? null : objective.key)}
              >
                <span className="solo-daily-objective-state" aria-hidden="true">{complete ? '✓' : index + 1}</span>
                <div className="solo-daily-objective-copy">
                  <span className="solo-daily-objective-name">
                    <strong>{objective.title}</strong>
                    <small aria-hidden="true">?</small>
                  </span>
                  <div className="solo-daily-objective-meta">
                    <span>{objective.current}/{objective.target}</span>
                    <small>+{objective.rewardXp} XP</small>
                  </div>
                  <progress
                    aria-label={`Progression de ${objective.title}`}
                    max={objective.target}
                    value={Math.min(objective.current, objective.target)}
                  />
                </div>
              </button>
            )
          })}
        </div>
      ) : (
        <p className="solo-daily-objectives-loading">Chargement de votre progression…</p>
      )}

      {expandedDailyObjective ? (
        <div className="solo-daily-objective-detail" id="solo-daily-objective-detail" role="region" aria-live="polite">
          <span aria-hidden="true">À faire</span>
          <p>
            <strong>{expandedDailyObjective.title}</strong>
            {expandedDailyObjective.description}
          </p>
        </div>
      ) : null}
    </section>
  ) : null

  const setupOptionsSlot = config.focusSkill ? (
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
  ) : null

  const modeHelpDialog = modeHelpOpen ? (
    <div
      className="solo-mode-help-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setModeHelpOpen(false)
      }}
    >
      <section
        className="solo-mode-help-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="solo-mode-help-title"
      >
        <header>
          <div>
            <span>Comment ça marche ?</span>
            <h2 id="solo-mode-help-title">{modeLabel}</h2>
          </div>
          <button
            type="button"
            className="solo-mode-help-close"
            aria-label="Fermer"
            autoFocus
            onClick={() => setModeHelpOpen(false)}
          >
            ×
          </button>
        </header>

        <p>
          {config.mode === 'tempo'
            ? 'Réponds à chaque question avant la fin de son chrono. La partie se termine après le nombre de questions choisi.'
            : 'Réponds correctement au plus grand nombre de questions avant la fin du chrono.'}
        </p>

        <div className="solo-mode-help-settings">
          {config.mode === 'tempo' ? (
            <>
              <label>
                <span>Nombre de questions</span>
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
                <span>Temps par question</span>
                <span className="solo-mode-help-input-unit">
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
                  <em>secondes</em>
                </span>
              </label>
            </>
          ) : (
            <label>
              <span>Durée du sprint</span>
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

        <button type="button" className="solo-mode-help-done" onClick={() => setModeHelpOpen(false)}>
          C’est compris
        </button>
      </section>
    </div>
  ) : null

  const saveStatusSlot = saveError ? (
    <div className="answer-feedback error">
      <strong>Erreur</strong>
      <span>{saveError}</span>
      {runRef.current && runRef.current.status !== 'completed' ? (
        <button
          className="secondary-button"
          type="button"
          disabled={saving}
          onClick={() => void finishSession()}
        >
          {saving ? 'Nouvel essai...' : 'Réessayer la finalisation'}
        </button>
      ) : null}
    </div>
  ) : saving ? (
    <p className="muted">Synchronisation en cours...</p>
  ) : null

  const feedbackSlot = saveError ? (
    <div className="answer-feedback error" role="alert">
      <strong>Connexion interrompue</strong>
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
  ) : null

  return (
    <PageFrame className={`game-page sprint-${status} solo-${status} ${config.mode}-${status} ${status === 'running' ? 'session-active' : ''} ${timerCritical ? 'timer-critical' : ''}`}>
      <PlayModeTabs onSelectMode={handleSelectPlayMode} />
      {status === 'idle' ? dailyObjectivesPanel : null}
      {pendingModePath ? (
        <PlayModeNavigationDialog
          targetPath={pendingModePath}
          onCancel={() => setPendingModePath(null)}
          onConfirm={confirmPendingModeChange}
        />
      ) : null}
      {modeHelpDialog}
      {status !== 'running' ? saveStatusSlot : null}

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
          answerCount={stats.totalQuestions}
          answerInputRef={inputRef}
          answerPulse={answerFeedback ? (answerFeedback.isCorrect ? 'correct' : 'wrong') : ''}
          contextLabel={`${modeLabel} - ${LEVEL_RUN_LABELS[config.level]}`}
          correctAnswerCount={stats.correctAnswers}
          elapsedLabel={`${elapsedSeconds}/${activeTimerTotalSeconds}`}
          feedbackSlot={feedbackSlot}
          metrics={statsCards}
          modeLabel="Solo"
          onAnswerChange={setAnswer}
          onExit={finishSession}
          onSubmit={handleSubmit}
          progressPercent={sessionProgress}
          question={question?.prompt ?? 'Question en préparation...'}
          questionProgressLabel={tempoQuestionProgressLabel}
          criticalRemainingSeconds={criticalRemainingSeconds(activeTimerTotalSeconds)}
          remainingSeconds={remainingSeconds}
        />
      ) : null}

      {status === 'finished' && runRef.current?.status === 'completed' ? (
        <SoloResultStage
          accuracy={accuracy}
          answers={sessionState.answers}
          modeLabel={modeLabel}
          sessionLabel={sessionLabel}
          skillLabel={(skill) => SKILL_LABELS[skill]}
          stats={stats}
          onReplay={startSession}
          onReturn={() => goToModeHome('/jeu/solo')}
        />
      ) : null}
    </PageFrame>
  )
}
