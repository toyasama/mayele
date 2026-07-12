const INTEGER_ANSWER_PATTERN = /^-?\d+$/

export function normalizeAnswerInput(value: string) {
  const trimmedValue = value.trimStart()
  const sign = trimmedValue.startsWith('-') ? '-' : ''
  const digits = trimmedValue.replace(/\D/g, '')

  return `${sign}${digits}`
}

export function parseAnswerInput(value: string) {
  const normalizedValue = value.trim()

  if (!INTEGER_ANSWER_PATTERN.test(normalizedValue)) {
    return null
  }

  const numericAnswer = Number(normalizedValue)

  if (!Number.isSafeInteger(numericAnswer)) {
    return null
  }

  return numericAnswer
}
