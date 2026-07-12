import {
  DEFAULT_SPRINT_DURATION_SECONDS,
  DEFAULT_TEMPO_QUESTION_COUNT,
  DEFAULT_TEMPO_QUESTION_SECONDS,
  type ChallengeMode,
  type SprintDurationSeconds,
  normalizeSprintDurationSeconds,
  normalizeTempoQuestionCount,
  normalizeTempoQuestionSeconds,
} from './challengeConfig'
import {
  calculateSessionXpEstimate,
  type AnswerResult,
  type GameLevel,
  type GameType,
  type Question,
  type SkillTag,
} from './game'
import { calculateSessionScorePoints } from './scoring'

export type SoloChallengeConfig = {
  mode: ChallengeMode
  game: GameType
  level: GameLevel
  focusSkill: SkillTag | null
  sprintDurationSeconds: SprintDurationSeconds
  tempoQuestionCount: number
  tempoQuestionSeconds: number
}

export type SoloSessionStats = {
  correctAnswers: number
  totalQuestions: number
  scorePoints: number
  xp: number
  currentStreak: number
  bestStreak: number
}

export type SoloSessionState = {
  config: SoloChallengeConfig
  stats: SoloSessionStats
  answers: AnswerResult[]
  activeQuestionIndex: number
}

type RecordSoloAnswerInput = {
  question: Question
  userAnswer: number | null
  responseTimeMs: number
}

export const initialSoloStats: SoloSessionStats = {
  correctAnswers: 0,
  totalQuestions: 0,
  scorePoints: 0,
  xp: 0,
  currentStreak: 0,
  bestStreak: 0,
}

export const DEFAULT_SOLO_CHALLENGE_CONFIG: SoloChallengeConfig = {
  mode: 'sprint',
  game: 'mixte',
  level: 'debutant',
  focusSkill: null,
  sprintDurationSeconds: DEFAULT_SPRINT_DURATION_SECONDS,
  tempoQuestionCount: DEFAULT_TEMPO_QUESTION_COUNT,
  tempoQuestionSeconds: DEFAULT_TEMPO_QUESTION_SECONDS,
}

export function normalizeSoloChallengeConfig(value: SoloChallengeConfig): SoloChallengeConfig {
  return {
    ...value,
    sprintDurationSeconds: normalizeSprintDurationSeconds(value.sprintDurationSeconds),
    tempoQuestionCount: normalizeTempoQuestionCount(value.tempoQuestionCount),
    tempoQuestionSeconds: normalizeTempoQuestionSeconds(value.tempoQuestionSeconds),
  }
}

export function createSoloSessionState(config: SoloChallengeConfig): SoloSessionState {
  return {
    config: normalizeSoloChallengeConfig(config),
    stats: initialSoloStats,
    answers: [],
    activeQuestionIndex: 0,
  }
}

export function totalSecondsForSoloConfig(config: SoloChallengeConfig) {
  const normalizedConfig = normalizeSoloChallengeConfig(config)

  if (normalizedConfig.mode === 'tempo') {
    return normalizedConfig.tempoQuestionCount * normalizedConfig.tempoQuestionSeconds
  }

  return normalizedConfig.sprintDurationSeconds
}

export function activeTimerSecondsForSoloConfig(config: SoloChallengeConfig) {
  const normalizedConfig = normalizeSoloChallengeConfig(config)

  return normalizedConfig.mode === 'tempo'
    ? normalizedConfig.tempoQuestionSeconds
    : normalizedConfig.sprintDurationSeconds
}

export function recordSoloAnswer(state: SoloSessionState, input: RecordSoloAnswerInput): SoloSessionState {
  const isCorrect = input.userAnswer !== null && input.userAnswer === input.question.answer
  const answerResult: AnswerResult = {
    questionIndex: state.activeQuestionIndex,
    prompt: input.question.prompt,
    correctAnswer: input.question.answer,
    userAnswer: input.userAnswer,
    responseTimeMs: Math.max(0, input.responseTimeMs),
    isCorrect,
    game: state.config.game,
    level: state.config.level,
    skill: input.question.skill,
  }
  const answers = [...state.answers, answerResult]
  const nextStreak = isCorrect ? state.stats.currentStreak + 1 : 0
  const correctAnswers = state.stats.correctAnswers + (isCorrect ? 1 : 0)
  const totalQuestions = state.stats.totalQuestions + 1
  const bestStreak = Math.max(state.stats.bestStreak, nextStreak)
  const stats = {
    correctAnswers,
    totalQuestions,
    scorePoints: calculateSessionScorePoints(state.config.level, answers),
    xp: calculateSessionXpEstimate(state.config.level, correctAnswers, totalQuestions, bestStreak),
    currentStreak: nextStreak,
    bestStreak,
  }

  return {
    ...state,
    stats,
    answers,
    activeQuestionIndex: state.activeQuestionIndex + 1,
  }
}

export function isSoloTempoComplete(state: SoloSessionState) {
  return state.config.mode === 'tempo' && state.activeQuestionIndex >= state.config.tempoQuestionCount
}
