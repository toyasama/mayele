import type { Prisma } from '../generated/prisma/client.js'

export type XpLedgerInput = {
  sourceType: 'session' | 'mission' | 'adjustment'
  sourceId: string
  amount: number
  metadata?: Prisma.InputJsonValue
}

export async function appendXpLedgerEntries(
  tx: Prisma.TransactionClient,
  playerId: string,
  entries: XpLedgerInput[],
) {
  const meaningfulEntries = entries.filter((entry) => Number.isInteger(entry.amount) && entry.amount !== 0)

  if (!meaningfulEntries.length) {
    const player = await tx.player.findUniqueOrThrow({ where: { id: playerId }, select: { totalXp: true } })
    return { awardedXp: 0, totalXp: player.totalXp, insertedEntries: 0 }
  }

  const inserted = await tx.xpLedgerEntry.createManyAndReturn({
    data: meaningfulEntries.map((entry) => ({
      playerId,
      sourceType: entry.sourceType,
      sourceId: entry.sourceId,
      amount: entry.amount,
      metadata: entry.metadata,
    })),
    skipDuplicates: true,
    select: { amount: true },
  })
  const awardedXp = inserted.reduce((sum, entry) => sum + entry.amount, 0)
  const player = awardedXp === 0
    ? await tx.player.findUniqueOrThrow({ where: { id: playerId }, select: { totalXp: true } })
    : await tx.player.update({
        where: { id: playerId },
        data: { totalXp: { increment: awardedXp } },
        select: { totalXp: true },
      })

  return { awardedXp, totalXp: player.totalXp, insertedEntries: inserted.length }
}
