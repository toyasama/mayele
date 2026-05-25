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
  prompt: string
  correctAnswer: number
  userAnswer: number
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

export const SESSION_SECONDS = 60

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

const LEVEL_POINTS: Record<GameLevel, number> = {
  debutant: 10,
  intermediaire: 14,
  avance: 18,
  expert: 24,
}

const OPERATIONS: Array<Exclude<GameType, 'mixte'>> = ['addition', 'soustraction', 'multiplication', 'division']

function randomBetween(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min
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

export function calculateQuestionPoints(level: GameLevel, streak: number) {
  return LEVEL_POINTS[level] + Math.min(20, streak * 2)
}

export function calculateAccuracy(correctAnswers: number, totalQuestions: number) {
  if (totalQuestions === 0) {
    return 0
  }

  return Math.round((correctAnswers / totalQuestions) * 100)
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
