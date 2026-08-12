import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  realtimeCommandReceipt: {
    create: vi.fn(),
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  },
}))

vi.mock('../lib/prisma.js', () => ({ prisma: prismaMock }))

const {
  claimRealtimeCommand,
  completeRealtimeCommand,
  releaseRealtimeCommand,
} = await import('./realtimeCommandReceiptService.js')

describe('realtimeCommandReceiptService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('attribue la premiere execution a un seul proprietaire', async () => {
    prismaMock.realtimeCommandReceipt.create.mockResolvedValue({ id: 'receipt-1' })

    const claim = await claimRealtimeCommand({
      playerId: 'player-a',
      matchId: 'match-1',
      eventName: 'match:submit-tempo-answer',
      commandId: 'command-1',
    }, 'node-a')

    expect(claim).toEqual({ kind: 'execute', receiptId: 'receipt-1', ownerToken: 'node-a' })
    expect(prismaMock.realtimeCommandReceipt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        playerId: 'player-a',
        matchId: 'match-1',
        eventName: 'match:submit-tempo-answer',
        commandId: 'command-1',
        ownerToken: 'node-a',
      }),
    })
  })

  it('renvoie le resultat canonique stocke a une autre instance', async () => {
    prismaMock.realtimeCommandReceipt.create.mockRejectedValue({
      code: 'P2002',
      meta: {
        driverAdapterError: {
          cause: {
            constraint: { fields: ['player_id', 'event_name', 'command_id'] },
          },
        },
      },
    })
    prismaMock.realtimeCommandReceipt.findUnique.mockResolvedValue({
      id: 'receipt-1',
      matchId: 'match-1',
      status: 'completed',
      lockedUntil: new Date(),
      response: { ok: true, data: { match: { id: 'match-1' } } },
    })

    const claim = await claimRealtimeCommand({
      playerId: 'player-a',
      matchId: 'match-1',
      eventName: 'match:submit-tempo-answer',
      commandId: 'command-1',
    }, 'node-b')

    expect(claim).toEqual({
      kind: 'completed',
      response: { ok: true, data: { match: { id: 'match-1' } } },
    })
  })

  it('reprend une commande uniquement apres expiration de sa lease', async () => {
    prismaMock.realtimeCommandReceipt.create.mockRejectedValue({
      code: 'P2002',
      meta: { target: 'realtime_command_receipts_player_id_event_name_command_id_key' },
    })
    prismaMock.realtimeCommandReceipt.findUnique.mockResolvedValue({
      id: 'receipt-1',
      matchId: 'match-1',
      status: 'processing',
      lockedUntil: new Date(0),
      response: null,
    })
    prismaMock.realtimeCommandReceipt.updateMany.mockResolvedValue({ count: 1 })

    const claim = await claimRealtimeCommand({
      playerId: 'player-a',
      matchId: 'match-1',
      eventName: 'match:submit-tempo-answer',
      commandId: 'command-1',
    }, 'node-b')

    expect(claim).toEqual({ kind: 'execute', receiptId: 'receipt-1', ownerToken: 'node-b' })
    expect(prismaMock.realtimeCommandReceipt.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'receipt-1', status: 'processing' }),
      data: expect.objectContaining({ ownerToken: 'node-b' }),
    }))
  })

  it('ne termine ou ne libere que la commande possedee par cette instance', async () => {
    prismaMock.realtimeCommandReceipt.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.realtimeCommandReceipt.deleteMany.mockResolvedValue({ count: 1 })
    const claim = { kind: 'execute' as const, receiptId: 'receipt-1', ownerToken: 'node-a' }

    await expect(completeRealtimeCommand(claim, { ok: true, data: { accepted: true } })).resolves.toBe(true)
    await releaseRealtimeCommand(claim)

    expect(prismaMock.realtimeCommandReceipt.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'receipt-1', status: 'processing', ownerToken: 'node-a' },
    }))
    expect(prismaMock.realtimeCommandReceipt.deleteMany).toHaveBeenCalledWith({
      where: { id: 'receipt-1', status: 'processing', ownerToken: 'node-a' },
    })
  })
})
