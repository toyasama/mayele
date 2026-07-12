import { describe, expect, it } from 'vitest'
import { normalizeAnswerInput, parseAnswerInput } from './answerInput'

describe('answerInput', () => {
  it('retire tout ce qui n est pas un chiffre en gardant un signe negatif initial', () => {
    expect(normalizeAnswerInput('12bb3')).toBe('123')
    expect(normalizeAnswerInput('1 2-3.4')).toBe('1234')
    expect(normalizeAnswerInput('-12bb3')).toBe('-123')
    expect(normalizeAnswerInput('  - 1 2')).toBe('-12')
  })

  it('parse uniquement une reponse entiere', () => {
    expect(parseAnswerInput('0')).toBe(0)
    expect(parseAnswerInput('42')).toBe(42)
    expect(parseAnswerInput(' 42 ')).toBe(42)
    expect(parseAnswerInput('-1')).toBe(-1)
  })

  it('refuse une reponse vide ou contaminee', () => {
    expect(parseAnswerInput('')).toBeNull()
    expect(parseAnswerInput('   ')).toBeNull()
    expect(parseAnswerInput('12bb3')).toBeNull()
    expect(parseAnswerInput('1.5')).toBeNull()
    expect(parseAnswerInput('-')).toBeNull()
  })

  it('refuse les entiers hors plage sure JavaScript', () => {
    expect(parseAnswerInput('9007199254740992')).toBeNull()
  })
})
