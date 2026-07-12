import { SPRINT_SESSION_SECONDS } from './challengeTiming'

export type GameType = 'addition' | 'soustraction' | 'multiplication' | 'division' | 'mixte'

export type GameLevel = 'debutant' | 'intermediaire' | 'avance' | 'expert'

export type SkillTag =
  | 'addition'
  | 'soustraction'
  | 'multiplication'
  | 'division'
  | 'retenues'
  | 'emprunts'
  | 'tables'
  | 'calcul_rapide'
  | 'mixte'

export type Question = {
  prompt: string
  answer: number
  operation: Exclude<GameType, 'mixte'>
  skill: SkillTag
}

export type AnswerResult = {
  questionIndex?: number
  prompt: string
  correctAnswer: number
  userAnswer: number | null
  responseTimeMs: number
  isCorrect: boolean
  game: GameType
  level: GameLevel
  skill: SkillTag
}

export type SkillPerformance = {
  skill: SkillTag
  attempts: number
  correctAnswers: number
  accuracy: number
}

export const SESSION_SECONDS = SPRINT_SESSION_SECONDS
const UNIQUE_QUESTION_ATTEMPTS = 120

export const GAME_LABELS: Record<GameType, string> = {
  addition: 'Addition',
  soustraction: 'Soustraction',
  multiplication: 'Multiplication',
  division: 'Division',
  mixte: 'Mixte',
}

export const LEVEL_LABELS: Record<GameLevel, string> = {
  debutant: 'Débutant',
  intermediaire: 'Intermédiaire',
  avance: 'Avancé',
  expert: 'Expert',
}

export const SKILL_LABELS: Record<SkillTag, string> = {
  addition: 'Additions',
  soustraction: 'Soustractions',
  multiplication: 'Multiplications',
  division: 'Divisions',
  retenues: 'Additions avec retenues',
  emprunts: 'Soustractions avec emprunts',
  tables: 'Tables',
  calcul_rapide: 'Calcul rapide',
  mixte: 'Mode mixte',
}

export const PLAYER_MAX_LEVEL = 100

const LEVEL_XP_BASE: Record<GameLevel, number> = {
  debutant: 4,
  intermediaire: 7,
  avance: 11,
  expert: 16,
}

const LEVEL_XP_CAP: Record<GameLevel, number> = {
  debutant: 180,
  intermediaire: 280,
  avance: 420,
  expert: 600,
}

const OPERATIONS: Array<Exclude<GameType, 'mixte'>> = ['addition', 'soustraction', 'multiplication', 'division']

function randomBetween(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function questionOperands(prompt: string) {
  return prompt.match(/-?\d+/g)?.map(Number).slice(0, 2) ?? []
}

export function questionIdentity(question: Pick<Question, 'operation' | 'prompt'>) {
  const operands = questionOperands(question.prompt)

  if (operands.length < 2) {
    return `${question.operation}:${question.prompt}`
  }

  const [left, right] = question.operation === 'addition' || question.operation === 'multiplication'
    ? [...operands].sort((first, second) => first - second)
    : operands

  return `${question.operation}:${left}:${right}`
}

function hasCarry(left: number, right: number) {
  return String(left)
    .split('')
    .reverse()
    .some((digit, index) => Number(digit) + Number(String(right).split('').reverse()[index] ?? 0) >= 10)
}

function hasBorrow(left: number, right: number) {
  return String(left)
    .split('')
    .reverse()
    .some((digit, index) => Number(digit) < Number(String(right).split('').reverse()[index] ?? 0))
}

function operationForSkill(skill: SkillTag): Exclude<GameType, 'mixte'> | null {
  if (skill === 'retenues') {
    return 'addition'
  }

  if (skill === 'emprunts') {
    return 'soustraction'
  }

  if (skill === 'tables') {
    return 'multiplication'
  }

  if (skill === 'addition' || skill === 'soustraction' || skill === 'multiplication' || skill === 'division') {
    return skill
  }

  return null
}

function pickOperation(game: GameType, focusSkill?: SkillTag | null): Exclude<GameType, 'mixte'> {
  const focusedOperation = focusSkill ? operationForSkill(focusSkill) : null

  if (focusedOperation) {
    return focusedOperation
  }

  if (game !== 'mixte') {
    return game
  }

  return OPERATIONS[randomBetween(0, OPERATIONS.length - 1)]
}

function additionSkill(left: number, right: number, focusSkill?: SkillTag | null): SkillTag {
  if (focusSkill === 'retenues') {
    return 'retenues'
  }

  return hasCarry(left, right) ? 'retenues' : 'addition'
}

function subtractionSkill(left: number, right: number, focusSkill?: SkillTag | null): SkillTag {
  if (focusSkill === 'emprunts') {
    return 'emprunts'
  }

  return hasBorrow(left, right) ? 'emprunts' : 'soustraction'
}

function multiplicationSkill(left: number, right: number, focusSkill?: SkillTag | null): SkillTag {
  if (focusSkill === 'tables') {
    return 'tables'
  }

  return left <= 12 && right <= 12 ? 'tables' : 'multiplication'
}

export function generateQuestion(game: GameType, level: GameLevel, focusSkill?: SkillTag | null): Question {
  const operation = pickOperation(game, focusSkill)

  if (operation === 'addition') {
    const ranges = {
      debutant: [1, 20, 1, 20],
      intermediaire: [10, 90, 10, 90],
      avance: [40, 300, 25, 250],
      expert: [120, 999, 80, 899],
    } satisfies Record<GameLevel, [number, number, number, number]>
    const [leftMin, leftMax, rightMin, rightMax] = ranges[level]
    const left = focusSkill === 'retenues' ? randomBetween(Math.max(18, leftMin), leftMax) : randomBetween(leftMin, leftMax)
    const right = focusSkill === 'retenues' ? randomBetween(Math.max(8, rightMin), rightMax) : randomBetween(rightMin, rightMax)
    return { prompt: `${left} + ${right}`, answer: left + right, operation, skill: additionSkill(left, right, focusSkill) }
  }

  if (operation === 'soustraction') {
    const ranges = {
      debutant: [5, 30],
      intermediaire: [20, 120],
      avance: [80, 500],
      expert: [250, 1500],
    } satisfies Record<GameLevel, [number, number]>
    const [min, max] = ranges[level]
    const left = randomBetween(min, max)
    const right = randomBetween(Math.max(1, Math.floor(min / 2)), left)
    return {
      prompt: `${left} - ${right}`,
      answer: left - right,
      operation,
      skill: subtractionSkill(left, right, focusSkill),
    }
  }

  if (operation === 'multiplication') {
    const ranges = {
      debutant: [2, 5],
      intermediaire: [2, 12],
      avance: [6, 18],
      expert: [11, 25],
    } satisfies Record<GameLevel, [number, number]>
    const [min, max] = focusSkill === 'tables' ? [2, 12] : ranges[level]
    const left = randomBetween(min, max)
    const right = randomBetween(min, max)
    return {
      prompt: `${left} × ${right}`,
      answer: left * right,
      operation,
      skill: multiplicationSkill(left, right, focusSkill),
    }
  }

  const ranges = {
    debutant: [2, 5, 2, 6],
    intermediaire: [2, 12, 2, 12],
    avance: [4, 18, 6, 20],
    expert: [8, 30, 8, 35],
  } satisfies Record<GameLevel, [number, number, number, number]>
  const [divisorMin, divisorMax, quotientMin, quotientMax] = ranges[level]
  const divisor = randomBetween(divisorMin, divisorMax)
  const quotient = randomBetween(quotientMin, quotientMax)
  const dividend = divisor * quotient

  return { prompt: `${dividend} ÷ ${divisor}`, answer: quotient, operation, skill: 'division' }
}

export function generateUniqueQuestion(
  game: GameType,
  level: GameLevel,
  focusSkill: SkillTag | null | undefined,
  usedQuestionKeys: ReadonlySet<string>,
) {
  for (let attempt = 0; attempt < UNIQUE_QUESTION_ATTEMPTS; attempt += 1) {
    const candidate = generateQuestion(game, level, focusSkill)

    if (!usedQuestionKeys.has(questionIdentity(candidate))) {
      return candidate
    }
  }

  return generateQuestion(game, level, focusSkill)
}

export function calculateAccuracy(correctAnswers: number, totalQuestions: number) {
  if (totalQuestions === 0) {
    return 0
  }

  return Math.round((correctAnswers / totalQuestions) * 100)
}

function accuracyMultiplier(accuracy: number, totalQuestions: number) {
  if (totalQuestions < 5) {
    return 1
  }

  if (accuracy === 100) {
    return 1.35
  }

  if (accuracy >= 90) {
    return 1.2
  }

  if (accuracy >= 80) {
    return 1.1
  }

  return 1
}

function streakBonus(bestStreak: number) {
  if (bestStreak >= 20) {
    return 80
  }

  if (bestStreak >= 10) {
    return 30
  }

  if (bestStreak >= 5) {
    return 10
  }

  return 0
}

export function calculateSessionXpEstimate(level: GameLevel, correctAnswers: number, totalQuestions: number, bestStreak: number) {
  if (correctAnswers <= 0 || totalQuestions <= 0) {
    return 0
  }

  const accuracy = calculateAccuracy(correctAnswers, totalQuestions)
  const baseXp = correctAnswers * LEVEL_XP_BASE[level]
  const xp = Math.round(baseXp * accuracyMultiplier(accuracy, totalQuestions) + streakBonus(bestStreak))

  return Math.min(LEVEL_XP_CAP[level], xp)
}

function clampPlayerLevel(level: number) {
  return Math.max(1, Math.min(PLAYER_MAX_LEVEL, Math.floor(level)))
}

export function xpRequiredForLevel(level: number) {
  const safeLevel = clampPlayerLevel(level)

  if (safeLevel <= 1) {
    return 0
  }

  return Math.round(120 * Math.pow(safeLevel - 1, 1.85))
}

export function getPlayerProgress(totalXp: number) {
  const safeTotalXp = Math.max(0, Math.floor(totalXp))
  let level = 1

  for (let candidate = 2; candidate <= PLAYER_MAX_LEVEL; candidate += 1) {
    if (safeTotalXp < xpRequiredForLevel(candidate)) {
      break
    }

    level = candidate
  }

  const currentLevelXp = xpRequiredForLevel(level)
  const nextLevel = level < PLAYER_MAX_LEVEL ? level + 1 : null
  const nextLevelXp = nextLevel ? xpRequiredForLevel(nextLevel) : currentLevelXp
  const xpIntoLevel = Math.max(0, safeTotalXp - currentLevelXp)
  const xpForNextLevel = nextLevel ? Math.max(1, nextLevelXp - currentLevelXp) : 0
  const xpRemaining = nextLevel ? Math.max(0, nextLevelXp - safeTotalXp) : 0
  const progress = nextLevel ? Math.round((xpIntoLevel / xpForNextLevel) * 100) : 100

  return {
    level,
    maxLevel: PLAYER_MAX_LEVEL,
    totalXp: safeTotalXp,
    currentLevelXp,
    nextLevel,
    nextLevelXp,
    xpIntoLevel,
    xpForNextLevel,
    xpRemaining,
    progress,
    isMaxLevel: level >= PLAYER_MAX_LEVEL,
  }
}

export function calculateRemainingSessionSeconds(endsAtMs: number, nowMs = Date.now()) {
  return Math.max(0, Math.ceil((endsAtMs - nowMs) / 1000))
}

export function calculateElapsedSessionSeconds(startedAtMs: number, nowMs = Date.now()) {
  return Math.max(1, Math.round((nowMs - startedAtMs) / 1000))
}

export function summarizeSkillPerformance(answers: AnswerResult[]): SkillPerformance[] {
  const bySkill = new Map<SkillTag, { attempts: number; correctAnswers: number }>()

  answers.forEach((answer) => {
    const current = bySkill.get(answer.skill) ?? { attempts: 0, correctAnswers: 0 }
    current.attempts += 1
    current.correctAnswers += answer.isCorrect ? 1 : 0
    bySkill.set(answer.skill, current)
  })

  return [...bySkill.entries()]
    .map(([skill, item]) => ({
      skill,
      attempts: item.attempts,
      correctAnswers: item.correctAnswers,
      accuracy: calculateAccuracy(item.correctAnswers, item.attempts),
    }))
    .sort((left, right) => left.accuracy - right.accuracy || right.attempts - left.attempts)
}
