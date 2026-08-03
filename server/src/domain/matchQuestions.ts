import type { GameLevel, GameType, SkillTag } from './constants.js'

export type MatchQuestion = {
  prompt: string
  answer: number
  operation: Exclude<GameType, 'mixte'>
  skill: SkillTag
}

type Operation = Exclude<GameType, 'mixte'>

const OPERATIONS: Operation[] = ['addition', 'soustraction', 'multiplication', 'division']
const UNIQUE_ADDITION_ATTEMPTS = 200
const subtractionLeftDecks = new Map<string, readonly number[]>()

const ADDITION_RANGES = {
  debutant: [1, 20, 1, 20],
  intermediaire: [10, 90, 10, 90],
  avance: [40, 300, 25, 250],
  expert: [120, 999, 80, 899],
} satisfies Record<GameLevel, [number, number, number, number]>

const SUBTRACTION_RANGES = {
  debutant: [5, 30],
  intermediaire: [20, 120],
  avance: [80, 500],
  expert: [250, 1500],
} satisfies Record<GameLevel, [number, number]>

const MULTIPLICATION_RANGES = {
  debutant: [2, 10],
  intermediaire: [2, 12],
  avance: [6, 18],
  expert: [11, 25],
} satisfies Record<GameLevel, [number, number]>

const DIVISION_RANGES = {
  debutant: [2, 5, 2, 6],
  intermediaire: [2, 12, 2, 12],
  avance: [4, 18, 6, 20],
  expert: [8, 30, 8, 35],
} satisfies Record<GameLevel, [number, number, number, number]>

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

function integerRange(min: number, max: number) {
  return Array.from({ length: max - min + 1 }, (_, index) => min + index)
}

function pickFromBalancedDeck<T>(seed: string, deckName: string, index: number, values: readonly T[]) {
  if (!values.length) {
    throw new Error(`empty_question_deck:${deckName}`)
  }

  const cycle = Math.floor(index / values.length)
  const position = index % values.length
  const shuffled = [...values]
  const random = seededRandom(`${seed}:${deckName}:${cycle}`)

  for (let cursor = shuffled.length - 1; cursor > 0; cursor -= 1) {
    const swapIndex = randomBetween(random, 0, cursor)
    ;[shuffled[cursor], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[cursor]]
  }

  return shuffled[position]!
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

function operationForSkill(skill: SkillTag | null | undefined): Operation | null {
  if (skill === 'retenues' || skill === 'addition') return 'addition'
  if (skill === 'emprunts' || skill === 'soustraction') return 'soustraction'
  if (skill === 'tables' || skill === 'multiplication') return 'multiplication'
  if (skill === 'division') return 'division'
  return null
}

function operationAtIndex(seed: string, index: number, game: GameType, focusSkill?: SkillTag | null): Operation {
  const focusedOperation = operationForSkill(focusSkill)

  if (focusedOperation) return focusedOperation
  if (game !== 'mixte') return game

  return pickFromBalancedDeck(seed, 'operations', index, OPERATIONS)
}

function operationQuestionIndex(
  seed: string,
  index: number,
  operation: Operation,
  game: GameType,
  focusSkill?: SkillTag | null,
) {
  if (operationForSkill(focusSkill) || game !== 'mixte') return index

  let operationIndex = 0

  for (let currentIndex = 0; currentIndex < index; currentIndex += 1) {
    if (operationAtIndex(seed, currentIndex, game, focusSkill) === operation) {
      operationIndex += 1
    }
  }

  return operationIndex
}

function questionOperands(prompt: string) {
  return prompt.match(/-?\d+/g)?.map(Number).slice(0, 2) ?? []
}

export function solveDisplayedQuestion(question: Pick<MatchQuestion, 'operation' | 'prompt'>) {
  const operands = questionOperands(question.prompt)

  if (operands.length < 2) {
    throw new Error(`invalid_question_prompt:${question.prompt}`)
  }

  const [left, right] = operands

  if (question.operation === 'addition') return left + right
  if (question.operation === 'soustraction') return left - right
  if (question.operation === 'multiplication') return left * right

  if (right === 0 || left % right !== 0) {
    throw new Error(`invalid_division_prompt:${question.prompt}`)
  }

  return left / right
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

function generateAdditionCandidate(
  seed: string,
  index: number,
  attempt: number,
  level: GameLevel,
  focusSkill?: SkillTag | null,
): MatchQuestion {
  const random = seededRandom(candidateSeed(seed, index, attempt))
  const [leftMin, leftMax, rightMin, rightMax] = ADDITION_RANGES[level]
  let left = randomBetween(random, leftMin, leftMax)
  let right = randomBetween(random, rightMin, rightMax)

  if (focusSkill === 'retenues') {
    for (let retry = 0; retry < 64 && !hasCarry(left, right); retry += 1) {
      left = randomBetween(random, leftMin, leftMax)
      right = randomBetween(random, rightMin, rightMax)
    }
  }

  return {
    prompt: `${left} + ${right}`,
    answer: left + right,
    operation: 'addition',
    skill: focusSkill === 'calcul_rapide'
      ? 'calcul_rapide'
      : focusSkill === 'retenues'
        ? 'retenues'
        : hasCarry(left, right) ? 'retenues' : 'addition',
  }
}

function generateUniqueAddition(seed: string, index: number, level: GameLevel, focusSkill?: SkillTag | null) {
  const usedQuestionKeys = new Set<string>()
  let question = generateAdditionCandidate(seed, 0, 0, level, focusSkill)

  for (let currentIndex = 0; currentIndex <= index; currentIndex += 1) {
    for (let attempt = 0; attempt < UNIQUE_ADDITION_ATTEMPTS; attempt += 1) {
      const candidate = generateAdditionCandidate(seed, currentIndex, attempt, level, focusSkill)

      if (!usedQuestionKeys.has(matchQuestionIdentity(candidate))) {
        question = candidate
        break
      }

      if (attempt === UNIQUE_ADDITION_ATTEMPTS - 1) {
        question = generateAdditionCandidate(seed, currentIndex, 0, level, focusSkill)
      }
    }

    usedQuestionKeys.add(matchQuestionIdentity(question))
  }

  return question
}

function subtractionRightValues(left: number, rightMin: number, focusSkill?: SkillTag | null) {
  const rights = integerRange(rightMin, left)
  return focusSkill === 'emprunts' ? rights.filter((right) => hasBorrow(left, right)) : rights
}

function subtractionLeftValues(level: GameLevel, focusSkill?: SkillTag | null) {
  const deckKey = `${level}:${focusSkill === 'emprunts' ? 'emprunts' : 'all'}`
  const cached = subtractionLeftDecks.get(deckKey)

  if (cached) return cached

  const [leftMin, leftMax] = SUBTRACTION_RANGES[level]
  const rightMin = Math.max(1, Math.floor(leftMin / 2))
  const values = integerRange(leftMin, leftMax).filter(
    (left) => focusSkill !== 'emprunts' || subtractionRightValues(left, rightMin, focusSkill).length > 0,
  )
  subtractionLeftDecks.set(deckKey, values)
  return values
}

function generateSubtraction(seed: string, index: number, level: GameLevel, focusSkill?: SkillTag | null): MatchQuestion {
  const [leftMin] = SUBTRACTION_RANGES[level]
  const rightMin = Math.max(1, Math.floor(leftMin / 2))
  const eligibleLefts = subtractionLeftValues(level, focusSkill)
  const left = pickFromBalancedDeck(seed, `subtraction-left:${level}:${focusSkill ?? 'all'}`, index, eligibleLefts)
  const leftCycle = Math.floor(index / eligibleLefts.length)
  const rights = subtractionRightValues(left, rightMin, focusSkill)
  const right = pickFromBalancedDeck(seed, `subtraction-right:${level}:${left}:${focusSkill ?? 'all'}`, leftCycle, rights)

  return {
    prompt: `${left} - ${right}`,
    answer: left - right,
    operation: 'soustraction',
    skill: focusSkill === 'calcul_rapide'
      ? 'calcul_rapide'
      : focusSkill === 'emprunts'
        ? 'emprunts'
        : hasBorrow(left, right) ? 'emprunts' : 'soustraction',
  }
}

function generateMultiplication(seed: string, index: number, level: GameLevel, focusSkill?: SkillTag | null): MatchQuestion {
  const [min, max] = focusSkill === 'tables' ? [2, 12] : MULTIPLICATION_RANGES[level]
  const pairs: Array<readonly [number, number]> = []

  for (let left = min; left <= max; left += 1) {
    for (let right = left; right <= max; right += 1) {
      pairs.push([left, right])
    }
  }

  const [first, second] = pickFromBalancedDeck(seed, `multiplication:${min}:${max}`, index, pairs)
  const shouldSwap = first !== second && seededRandom(`${seed}:multiplication-orientation:${index}`)() >= 0.5
  const [left, right] = shouldSwap ? [second, first] : [first, second]

  return {
    prompt: `${left} x ${right}`,
    answer: left * right,
    operation: 'multiplication',
    skill: focusSkill === 'calcul_rapide' ? 'calcul_rapide' : left <= 12 && right <= 12 ? 'tables' : 'multiplication',
  }
}

function generateDivision(seed: string, index: number, level: GameLevel, focusSkill?: SkillTag | null): MatchQuestion {
  const [divisorMin, divisorMax, quotientMin, quotientMax] = DIVISION_RANGES[level]
  const pairs: Array<readonly [number, number]> = []

  for (let divisor = divisorMin; divisor <= divisorMax; divisor += 1) {
    for (let quotient = quotientMin; quotient <= quotientMax; quotient += 1) {
      pairs.push([divisor, quotient])
    }
  }

  const [divisor, quotient] = pickFromBalancedDeck(seed, `division:${level}`, index, pairs)

  return {
    prompt: `${divisor * quotient} / ${divisor}`,
    answer: quotient,
    operation: 'division',
    skill: focusSkill === 'calcul_rapide' ? 'calcul_rapide' : 'division',
  }
}

export function generateMatchQuestion(
  seed: string,
  index: number,
  game: GameType,
  level: GameLevel,
  focusSkill?: SkillTag | null,
): MatchQuestion {
  const operation = operationAtIndex(seed, index, game, focusSkill)
  const questionIndex = operationQuestionIndex(seed, index, operation, game, focusSkill)

  if (operation === 'addition') return generateUniqueAddition(seed, questionIndex, level, focusSkill)
  if (operation === 'soustraction') return generateSubtraction(seed, questionIndex, level, focusSkill)
  if (operation === 'multiplication') return generateMultiplication(seed, questionIndex, level, focusSkill)
  return generateDivision(seed, questionIndex, level, focusSkill)
}
