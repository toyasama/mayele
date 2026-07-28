import { prisma } from '../src/lib/prisma.js'

const players = await prisma.player.findMany({
  select: {
    id: true,
    totalXp: true,
    xpLedgerEntries: { select: { amount: true } },
  },
})
const mismatches = players
  .filter((player) => player.totalXp !== player.xpLedgerEntries.reduce((sum, entry) => sum + entry.amount, 0))
  .map((player) => player.id)
const outbox = await prisma.outboxEvent.groupBy({ by: ['status'], _count: { _all: true } })

console.log(JSON.stringify({ players: players.length, ledgerMismatches: mismatches, outbox }))
await prisma.$disconnect()

if (mismatches.length) process.exitCode = 1
