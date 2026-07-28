import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { generateMatchQuestion as generateServerQuestion } from '../../../server/src/domain/matchQuestions'
import { generateMatchQuestion as generateClientQuestion } from './matchQuestions'
import type { GameLevel, GameType, SkillTag } from './game'

const GAMES: GameType[] = ['addition', 'soustraction', 'multiplication', 'division', 'mixte']
const LEVELS: GameLevel[] = ['debutant', 'intermediaire', 'avance', 'expert']
const FOCUSED_SKILLS: SkillTag[] = ['retenues', 'emprunts', 'tables', 'calcul_rapide']

describe('parite du generateur de questions', () => {
  it('garde un miroir source exact en dehors de l import des types', () => {
    const clientSource = readFileSync(resolve(process.cwd(), 'src/lib/matchQuestions.ts'), 'utf8')
    const serverSource = readFileSync(resolve(process.cwd(), '../server/src/domain/matchQuestions.ts'), 'utf8')
    const withoutTypeImport = (source: string) => source.split(/\r?\n/).slice(1).join('\n')

    expect(withoutTypeImport(clientSource)).toBe(withoutTypeImport(serverSource))
  })

  it('produit les memes questions standard sur le client et le serveur', () => {
    for (const seed of ['parity-a', 'parity-b', 'parity-c']) {
      for (const game of GAMES) {
        for (const level of LEVELS) {
          for (let index = 0; index < 50; index += 1) {
            expect(generateClientQuestion(seed, index, game, level)).toEqual(
              generateServerQuestion(seed, index, game, level),
            )
          }
        }
      }
    }
  })

  it('reste identique pour les entrainements cibles', () => {
    for (const skill of FOCUSED_SKILLS) {
      for (const level of LEVELS) {
        for (let index = 0; index < 20; index += 1) {
          expect(generateClientQuestion('focused-parity', index, 'mixte', level, skill)).toEqual(
            generateServerQuestion('focused-parity', index, 'mixte', level, skill),
          )
        }
      }
    }
  })
})
