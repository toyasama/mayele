import type { GameLevel, GameType, SkillTag } from './game'

export type MatchQuestion = {
  prompt: string
  answer: number
  operation: Exclude<GameType, 'mixte'>
  skill: SkillTag
}

const OPERATIONS: Array<Exclude<GameType, 'mixte'>> = ['addition', 'soustraction', 'multiplication', 'division']
const UNIQUE_QUESTION_ATTEMPTS = 200

function hashSeed(value: string) {
  let hash = 2166136261

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return hash >>> 0
}

function seededRandom(seed: string) {
  let state = hashSeed(seed)

  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function randomBetween(random: () => number, min: number, max: number) {
  return Math.floor(random() * (max - min + 1)) + min
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

function pickOperation(random: () => number, game: GameType): Exclude<GameType, 'mixte'> {
  if (game !== 'mixte') {
    return game
  }

  return OPERATIONS[randomBetween(random, 0, OPERATIONS.length - 1)]
}

function questionOperands(prompt: string) {
  return prompt.match(/-?\d+/g)?.map(Number).slice(0, 2) ?? []
}

export function matchQuestionIdentity(question: Pick<MatchQuestion, 'operation' | 'prompt'>) {
  const operands = questionOperands(question.prompt)

  if (operands.length < 2) {
    return `${question.operation}:${question.prompt}`
  }

  const [left, right] = question.operation === 'addition' || question.operation === 'multiplication'
    ? [...operands].sort((first, second) => first - second)
    : operands

  return `${question.operation}:${left}:${right}`
}

function candidateSeed(seed: string, index: number, attempt: number) {
  return attempt === 0 ? `${seed}:${index}` : `${seed}:${index}:${attempt}`
}

function generateMatchQuestionCandidate(seed: string, index: number, attempt: number, game: GameType, level: GameLevel): MatchQuestion {
  const random = seededRandom(candidateSeed(seed, index, attempt))
  const operation = pickOperation(random, game)

  if (operation === 'addition') {
    const ranges = {
      debutant: [1, 20, 1, 20],
      intermediaire: [10, 90, 10, 90],
      avance: [40, 300, 25, 250],
      expert: [120, 999, 80, 899],
    } satisfies Record<GameLevel, [number, number, number, number]>
    const [leftMin, leftMax, rightMin, rightMax] = ranges[level]
    const left = randomBetween(random, leftMin, leftMax)
    const right = randomBetween(random, rightMin, rightMax)

    return {
      prompt: `${left} + ${right}`,
      answer: left + right,
      operation,
      skill: hasCarry(left, right) ? 'retenues' : 'addition',
    }
  }

  if (operation === 'soustraction') {
    const ranges = {
      debutant: [5, 30],
      intermediaire: [20, 120],
      avance: [80, 500],
      expert: [250, 1500],
    } satisfies Record<GameLevel, [number, number]>
    const [min, max] = ranges[level]
    const left = randomBetween(random, min, max)
    const right = randomBetween(random, Math.max(1, Math.floor(min / 2)), left)

    return {
      prompt: `${left} - ${right}`,
      answer: left - right,
      operation,
      skill: hasBorrow(left, right) ? 'emprunts' : 'soustraction',
    }
  }

  if (operation === 'multiplication') {
    const ranges = {
      debutant: [2, 5],
      intermediaire: [2, 12],
      avance: [6, 18],
      expert: [11, 25],
    } satisfies Record<GameLevel, [number, number]>
    const [min, max] = ranges[level]
    const left = randomBetween(random, min, max)
    const right = randomBetween(random, min, max)

    return {
      prompt: `${left} x ${right}`,
      answer: left * right,
      operation,
      skill: left <= 12 && right <= 12 ? 'tables' : 'multiplication',
    }
  }

  const ranges = {
    debutant: [2, 5, 2, 6],
    intermediaire: [2, 12, 2, 12],
    avance: [4, 18, 6, 20],
    expert: [8, 30, 8, 35],
  } satisfies Record<GameLevel, [number, number, number, number]>
  const [divisorMin, divisorMax, quotientMin, quotientMax] = ranges[level]
  const divisor = randomBetween(random, divisorMin, divisorMax)
  const quotient = randomBetween(random, quotientMin, quotientMax)

  return { prompt: `${divisor * quotient} / ${divisor}`, answer: quotient, operation, skill: 'division' }
}

function generateUniqueMatchQuestion(seed: string, index: number, game: GameType, level: GameLevel, usedQuestionKeys: ReadonlySet<string>) {
  for (let attempt = 0; attempt < UNIQUE_QUESTION_ATTEMPTS; attempt += 1) {
    const candidate = generateMatchQuestionCandidate(seed, index, attempt, game, level)

    if (!usedQuestionKeys.has(matchQuestionIdentity(candidate))) {
      return candidate
    }
  }

  return generateMatchQuestionCandidate(seed, index, 0, game, level)
}

export function generateMatchQuestion(seed: string, index: number, game: GameType, level: GameLevel): MatchQuestion {
  const usedQuestionKeys = new Set<string>()
  let question = generateMatchQuestionCandidate(seed, 0, 0, game, level)

  for (let currentIndex = 0; currentIndex <= index; currentIndex += 1) {
    question = generateUniqueMatchQuestion(seed, currentIndex, game, level, usedQuestionKeys)
    usedQuestionKeys.add(matchQuestionIdentity(question))
  }

  return question
}
