export type GameType = 'addition' | 'soustraction' | 'multiplication' | 'mixte'

export type GameLevel = 'debutant' | 'intermediaire' | 'avance' | 'expert'

export type Question = {
  prompt: string
  answer: number
  operation: Exclude<GameType, 'mixte'>
}

export const SESSION_SECONDS = 60

export const GAME_LABELS: Record<GameType, string> = {
  addition: 'Addition',
  soustraction: 'Soustraction',
  multiplication: 'Multiplication',
  mixte: 'Mixte',
}

export const LEVEL_LABELS: Record<GameLevel, string> = {
  debutant: 'Débutant',
  intermediaire: 'Intermédiaire',
  avance: 'Avancé',
  expert: 'Expert',
}

const LEVEL_POINTS: Record<GameLevel, number> = {
  debutant: 10,
  intermediaire: 14,
  avance: 18,
  expert: 24,
}

const OPERATIONS: Array<Exclude<GameType, 'mixte'>> = ['addition', 'soustraction', 'multiplication']

function randomBetween(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function pickOperation(game: GameType): Exclude<GameType, 'mixte'> {
  if (game !== 'mixte') {
    return game
  }

  return OPERATIONS[randomBetween(0, OPERATIONS.length - 1)]
}

export function generateQuestion(game: GameType, level: GameLevel): Question {
  const operation = pickOperation(game)

  if (operation === 'addition') {
    const ranges = {
      debutant: [1, 20, 1, 20],
      intermediaire: [10, 90, 10, 90],
      avance: [40, 300, 25, 250],
      expert: [120, 999, 80, 899],
    } satisfies Record<GameLevel, [number, number, number, number]>
    const [leftMin, leftMax, rightMin, rightMax] = ranges[level]
    const left = randomBetween(leftMin, leftMax)
    const right = randomBetween(rightMin, rightMax)
    return { prompt: `${left} + ${right}`, answer: left + right, operation }
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
    return { prompt: `${left} - ${right}`, answer: left - right, operation }
  }

  const ranges = {
    debutant: [2, 5],
    intermediaire: [2, 12],
    avance: [6, 18],
    expert: [11, 25],
  } satisfies Record<GameLevel, [number, number]>
  const [min, max] = ranges[level]
  const left = randomBetween(min, max)
  const right = randomBetween(min, max)
  return { prompt: `${left} × ${right}`, answer: left * right, operation }
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
