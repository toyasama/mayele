import { beforeEach, describe, expect, it, vi } from 'vitest'

const playerA = {
  id: 'player_a',
  name: 'Awa Diallo',
  username: 'awa',
  avatarUrl: null,
  totalXp: 120,
  presenceStatus: 'online',
  presenceUpdatedAt: new Date('2026-07-07T10:00:00.000Z'),
}

const playerB = {
  id: 'player_b',
  name: 'Moussa Kane',
  username: 'moussa',
  avatarUrl: null,
  totalXp: 240,
  presenceStatus: 'away',
  presenceUpdatedAt: new Date('2026-07-07T10:00:00.000Z'),
}

const prismaMock = vi.hoisted(() => ({
  player: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
  },
  friendship: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    deleteMany: vi.fn(),
  },
  friendRequest: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
  },
  $transaction: vi.fn(),
}))

const transactionMock = vi.hoisted(() => ({
  friendRequest: {
    update: vi.fn(),
  },
  friendship: {
    upsert: vi.fn(),
  },
}))

vi.mock('../lib/prisma.js', () => ({
  prisma: prismaMock,
}))

const {
  acceptFriendRequest,
  cancelFriendRequest,
  FriendServiceError,
  getSocialOverview,
  listFriends,
  removeFriend,
  searchPlayersByUsername,
  sendFriendRequest,
} = await import('./friendService.js')

describe('friendService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.$transaction.mockImplementation(async (callback) => callback(transactionMock))
  })

  it('recherche les joueurs par prefixe de username en excluant le joueur courant', async () => {
    prismaMock.player.findMany.mockResolvedValueOnce([playerB])

    const players = await searchPlayersByUsername('player_a', 'Mou')

    expect(players).toEqual([playerB])
    expect(prismaMock.player.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: { not: 'player_a' },
          username: { startsWith: 'mou' },
        },
        take: 10,
      }),
    )
  })

  it('liste les amis en retournant le joueur oppose de chaque relation', async () => {
    prismaMock.friendship.findMany.mockResolvedValueOnce([
      { playerAId: 'player_a', playerBId: 'player_b', playerA, playerB },
    ])

    await expect(listFriends('player_a')).resolves.toEqual([playerB])
  })

  it('agrège amis et demandes dans un seul overview social', async () => {
    prismaMock.friendship.findMany.mockResolvedValueOnce([
      { playerAId: 'player_a', playerBId: 'player_b', playerA, playerB },
    ])
    prismaMock.friendRequest.findMany.mockResolvedValueOnce([
      {
        id: 'incoming_1',
        createdAt: new Date('2026-07-07T10:00:00.000Z'),
        sender: playerB,
      },
    ])
    prismaMock.friendRequest.findMany.mockResolvedValueOnce([])

    const overview = await getSocialOverview('player_a')

    expect(overview.friends).toEqual([playerB])
    expect(overview.incoming).toEqual([
      {
        id: 'incoming_1',
        createdAt: new Date('2026-07-07T10:00:00.000Z'),
        player: playerB,
      },
    ])
    expect(overview.outgoing).toEqual([])
  })

  it("rejette l'auto-demande d'ami", async () => {
    await expect(sendFriendRequest('player_a', 'player_a')).rejects.toMatchObject({
      code: 'self_friend_request',
    })
  })

  it("rejette une demande vers un joueur inexistant", async () => {
    prismaMock.player.findUnique.mockResolvedValueOnce(null)

    await expect(sendFriendRequest('player_a', 'missing')).rejects.toMatchObject({
      code: 'player_not_found',
    })
  })

  it('rejette une demande si les joueurs sont deja amis', async () => {
    prismaMock.player.findUnique.mockResolvedValueOnce(playerB)
    prismaMock.friendship.findUnique.mockResolvedValueOnce({ id: 'friendship_1' })

    await expect(sendFriendRequest('player_a', 'player_b')).rejects.toMatchObject({
      code: 'already_friends',
    })
  })

  it('rejette une demande sortante deja en attente', async () => {
    prismaMock.player.findUnique.mockResolvedValueOnce(playerB)
    prismaMock.friendship.findUnique.mockResolvedValueOnce(null)
    prismaMock.friendRequest.findUnique.mockResolvedValueOnce({ id: 'request_1', status: 'pending' })

    await expect(sendFriendRequest('player_a', 'player_b')).rejects.toMatchObject({
      code: 'friend_request_already_pending',
    })
  })

  it('rejette une demande si une demande inverse est deja en attente', async () => {
    prismaMock.player.findUnique.mockResolvedValueOnce(playerB)
    prismaMock.friendship.findUnique.mockResolvedValueOnce(null)
    prismaMock.friendRequest.findUnique.mockResolvedValueOnce(null)
    prismaMock.friendRequest.findUnique.mockResolvedValueOnce({ id: 'request_2', status: 'pending' })

    await expect(sendFriendRequest('player_a', 'player_b')).rejects.toMatchObject({
      code: 'incoming_friend_request_exists',
    })
  })

  it("cree une demande d'ami valide", async () => {
    prismaMock.player.findUnique.mockResolvedValueOnce(playerB)
    prismaMock.friendship.findUnique.mockResolvedValueOnce(null)
    prismaMock.friendRequest.findUnique.mockResolvedValueOnce(null)
    prismaMock.friendRequest.findUnique.mockResolvedValueOnce(null)
    prismaMock.friendRequest.create.mockResolvedValueOnce({
      id: 'request_1',
      senderId: 'player_a',
      receiverId: 'player_b',
      status: 'pending',
      createdAt: new Date('2026-07-07T10:00:00.000Z'),
      respondedAt: null,
    })

    const request = await sendFriendRequest('player_a', 'player_b')

    expect(request.id).toBe('request_1')
    expect(request.player).toEqual(playerB)
    expect(prismaMock.friendRequest.create).toHaveBeenCalledWith({
      data: { senderId: 'player_a', receiverId: 'player_b' },
    })
  })

  it("accepte une demande et cree l'amitie dans l'ordre canonique", async () => {
    prismaMock.friendRequest.findUnique.mockResolvedValueOnce({
      id: 'request_1',
      senderId: 'player_b',
      receiverId: 'player_a',
      status: 'pending',
      sender: playerB,
    })

    const friend = await acceptFriendRequest('player_a', 'request_1')

    expect(friend).toEqual(playerB)
    expect(transactionMock.friendRequest.update).toHaveBeenCalledWith({
      where: { id: 'request_1' },
      data: { status: 'accepted', respondedAt: expect.any(Date) },
    })
    expect(transactionMock.friendship.upsert).toHaveBeenCalledWith({
      where: { playerAId_playerBId: { playerAId: 'player_a', playerBId: 'player_b' } },
      update: {},
      create: { playerAId: 'player_a', playerBId: 'player_b' },
    })
  })

  it('supprime une amitie existante', async () => {
    prismaMock.friendship.deleteMany.mockResolvedValueOnce({ count: 1 })

    await expect(removeFriend('player_b', 'player_a')).resolves.toBeUndefined()

    expect(prismaMock.friendship.deleteMany).toHaveBeenCalledWith({
      where: { playerAId: 'player_a', playerBId: 'player_b' },
    })
  })

  it("rejette la suppression d'une amitie inexistante", async () => {
    prismaMock.friendship.deleteMany.mockResolvedValueOnce({ count: 0 })

    await expect(removeFriend('player_a', 'player_b')).rejects.toBeInstanceOf(FriendServiceError)
  })

  it("annule une demande envoyee par le joueur courant", async () => {
    prismaMock.friendRequest.findUnique.mockResolvedValueOnce({
      id: 'request_1',
      senderId: 'player_a',
      receiverId: 'player_b',
      status: 'pending',
      receiver: playerB,
    })
    prismaMock.friendRequest.update.mockResolvedValueOnce({
      id: 'request_1',
      senderId: 'player_a',
      receiverId: 'player_b',
      status: 'cancelled',
    })

    await expect(cancelFriendRequest('player_a', 'request_1')).resolves.toEqual(playerB)
    expect(prismaMock.friendRequest.update).toHaveBeenCalledWith({
      where: { id: 'request_1' },
      data: { status: 'cancelled', respondedAt: expect.any(Date) },
    })
  })

  it("rejette l'annulation d'une demande envoyee par un autre joueur", async () => {
    prismaMock.friendRequest.findUnique.mockResolvedValueOnce({
      id: 'request_1',
      senderId: 'player_b',
      receiverId: 'player_a',
      status: 'pending',
      receiver: playerA,
    })

    await expect(cancelFriendRequest('player_a', 'request_1')).rejects.toMatchObject({
      code: 'friend_request_not_owned',
    })
  })
})
