import { describe, expect, it, vi } from 'vitest'
import type { Prisma } from '../generated/prisma/client.js'
import { appendXpLedgerEntries } from './xpLedgerService.js'

function transactionMock(insertedAmounts: number[], totalXp = 500) {
  return {
    xpLedgerEntry: {
      createManyAndReturn: vi.fn(async () => insertedAmounts.map((amount) => ({ amount }))),
    },
    player: {
      findUniqueOrThrow: vi.fn(async () => ({ totalXp })),
      update: vi.fn(async ({ data }: { data: { totalXp: { increment: number } } }) => ({
        totalXp: totalXp + data.totalXp.increment,
      })),
    },
  }
}

describe('appendXpLedgerEntries', () => {
  it('incrémente la projection uniquement avec les écritures réellement insérées', async () => {
    const tx = transactionMock([120], 500)
    const result = await appendXpLedgerEntries(tx as unknown as Prisma.TransactionClient, 'player-1', [
      { sourceType: 'session', sourceId: 'session-1', amount: 120 },
      { sourceType: 'mission', sourceId: '2026-07-19:mission-1', amount: 30 },
    ])

    expect(result).toEqual({ awardedXp: 120, totalXp: 620, insertedEntries: 1 })
    expect(tx.player.update).toHaveBeenCalledWith({
      where: { id: 'player-1' },
      data: { totalXp: { increment: 120 } },
      select: { totalXp: true },
    })
  })

  it('relit le solde sans l’incrémenter quand toutes les sources sont déjà présentes', async () => {
    const tx = transactionMock([], 620)
    const result = await appendXpLedgerEntries(tx as unknown as Prisma.TransactionClient, 'player-1', [
      { sourceType: 'session', sourceId: 'session-1', amount: 120 },
    ])

    expect(result).toEqual({ awardedXp: 0, totalXp: 620, insertedEntries: 0 })
    expect(tx.player.update).not.toHaveBeenCalled()
    expect(tx.player.findUniqueOrThrow).toHaveBeenCalledOnce()
  })

  it('ignore les mouvements nuls mais conserve les ajustements négatifs auditables', async () => {
    const tx = transactionMock([-20], 620)
    const result = await appendXpLedgerEntries(tx as unknown as Prisma.TransactionClient, 'player-1', [
      { sourceType: 'adjustment', sourceId: 'support-1', amount: -20 },
      { sourceType: 'adjustment', sourceId: 'noop', amount: 0 },
    ])

    expect(result.totalXp).toBe(600)
    expect(tx.xpLedgerEntry.createManyAndReturn).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ sourceId: 'support-1', amount: -20 })],
    }))
  })
})
