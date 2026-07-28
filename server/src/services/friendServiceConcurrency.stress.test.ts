import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Prisma } from '../generated/prisma/client.js'

const prismaMock = vi.hoisted(() => ({
  friendship: { findUnique: vi.fn() },
}))

vi.mock('../lib/prisma.js', () => ({ prisma: prismaMock }))

const {
  acceptFriendRequestInTransaction,
  cancelFriendRequestInTransaction,
  declineFriendRequestInTransaction,
  sendFriendRequestInTransaction,
} = await import('./friendService.js')

const playerB = {
  id: 'player-b',
  name: 'Binta',
  username: 'binta',
  avatarUrl: null,
  totalXp: 100,
  presenceStatus: 'offline',
  presenceUpdatedAt: new Date('2026-07-19T00:00:00.000Z'),
}

function transaction() {
  return {
    player: {
      findUnique: vi.fn().mockResolvedValue(playerB),
    },
    friendship: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({ id: 'friendship-1' }),
      deleteMany: vi.fn(),
    },
    friendRequest: {
      findUnique: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
  }
}

describe('friendService optimistic concurrency guards', () => {
  beforeEach(() => vi.clearAllMocks())

  it('maps a same-direction unique race to a domain conflict', async () => {
    const tx = transaction()
    tx.friendRequest.findUnique.mockResolvedValue(null)
    tx.friendRequest.create.mockRejectedValue({ code: 'P2002', meta: { target: ['sender_id', 'receiver_id'] } })

    await expect(sendFriendRequestInTransaction(
      tx as unknown as Prisma.TransactionClient,
      'player-a',
      'player-b',
    )).rejects.toMatchObject({ code: 'friend_request_already_pending' })
  })

  it('maps the unordered-pair unique guard to a conflict during crossed sends', async () => {
    const tx = transaction()
    tx.friendRequest.findUnique.mockResolvedValue(null)
    tx.friendRequest.create.mockRejectedValue({
      code: 'P2002',
      meta: { target: ['friend_requests_one_pending_pair_idx'] },
    })

    await expect(sendFriendRequestInTransaction(
      tx as unknown as Prisma.TransactionClient,
      'player-b',
      'player-a',
    )).rejects.toMatchObject({ code: 'friend_request_already_pending' })
    expect(tx.friendRequest.create).toHaveBeenCalledTimes(1)
  })

  it('rejects a stale reactivation when another command already made it pending', async () => {
    const tx = transaction()
    tx.friendRequest.findUnique
      .mockResolvedValueOnce({
        id: 'request-1',
        senderId: 'player-a',
        receiverId: 'player-b',
        status: 'declined',
        createdAt: new Date('2026-07-19T00:00:00.000Z'),
      })
      .mockResolvedValueOnce(null)
    tx.friendRequest.updateMany.mockResolvedValue({ count: 0 })

    await expect(sendFriendRequestInTransaction(
      tx as unknown as Prisma.TransactionClient,
      'player-a',
      'player-b',
    )).rejects.toMatchObject({ code: 'friend_request_already_pending' })
    expect(tx.friendRequest.create).not.toHaveBeenCalled()
  })

  it('does not create a friendship when a concurrent terminal action won first', async () => {
    const tx = transaction()
    tx.friendRequest.findUnique.mockResolvedValue({
      id: 'request-1',
      senderId: 'player-b',
      receiverId: 'player-a',
      status: 'pending',
      sender: playerB,
    })
    tx.friendRequest.updateMany.mockResolvedValue({ count: 0 })

    await expect(acceptFriendRequestInTransaction(
      tx as unknown as Prisma.TransactionClient,
      'player-a',
      'request-1',
    )).rejects.toMatchObject({ code: 'friend_request_not_pending' })
    expect(tx.friendship.upsert).not.toHaveBeenCalled()
  })

  it.each([
    {
      action: 'decline',
      run: declineFriendRequestInTransaction,
      request: {
        id: 'request-1',
        senderId: 'player-b',
        receiverId: 'player-a',
        status: 'pending',
        sender: playerB,
      },
    },
    {
      action: 'cancel',
      run: cancelFriendRequestInTransaction,
      request: {
        id: 'request-1',
        senderId: 'player-a',
        receiverId: 'player-b',
        status: 'pending',
        receiver: playerB,
      },
    },
  ])('rejects stale $action after a concurrent terminal update', async ({ run, request }) => {
    const tx = transaction()
    tx.friendRequest.findUnique.mockResolvedValue(request)
    tx.friendRequest.updateMany.mockResolvedValue({ count: 0 })

    await expect(run(
      tx as unknown as Prisma.TransactionClient,
      'player-a',
      'request-1',
    )).rejects.toMatchObject({ code: 'friend_request_not_pending' })
  })
})
