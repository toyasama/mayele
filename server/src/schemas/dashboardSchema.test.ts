import { describe, expect, it } from 'vitest'
import { operationHistoryQuerySchema } from './dashboardSchema.js'

describe('operationHistoryQuerySchema', () => {
  it('valide une combinaison et applique la limite par défaut', () => {
    expect(operationHistoryQuerySchema.parse({ game: 'addition', level: 'debutant' })).toEqual({
      game: 'addition',
      level: 'debutant',
      limit: 20,
    })
  })

  it('refuse une opération, un niveau ou une limite hors contrat', () => {
    expect(() => operationHistoryQuerySchema.parse({ game: 'addition', level: 'impossible' })).toThrow()
    expect(() => operationHistoryQuerySchema.parse({ game: 'inconnue', level: 'debutant' })).toThrow()
    expect(() => operationHistoryQuerySchema.parse({ game: 'addition', level: 'debutant', limit: 21 })).toThrow()
  })
})
