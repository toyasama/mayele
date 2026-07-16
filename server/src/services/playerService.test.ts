import { describe, expect, it, vi } from 'vitest'

// --- Mocks ---

vi.mock('../lib/clerkCache.js', () => ({
  getClerkUserFromCache: vi.fn(() => null),
  setClerkUserInCache: vi.fn(),
  invalidateClerkUserCache: vi.fn(),
}))

vi.mock('../middleware/auth.js', () => ({
  getClerkUser: vi.fn(async () => ({
    id: 'clerk_123',
    firstName: 'Awa',
    lastName: 'Diallo',
    username: 'awa',
    primaryEmailAddress: { emailAddress: 'awa@test.com' },
    imageUrl: null,
  })),
}))

const existingPlayer = {
  id: 'player_1',
  clerkUserId: 'clerk_123',
  email: 'awa@test.com',
  name: 'Awa Diallo',
  firstName: 'Awa',
  lastName: 'Diallo',
  birthDate: new Date('2000-01-01'),
  username: 'awa',
  avatarUrl: null as string | null,
  timeZone: 'Europe/Paris',
  presenceStatus: 'online',
  presenceUpdatedAt: new Date(),
  totalXp: 500,
  createdAt: new Date(),
  updatedAt: new Date(),
}

const prismaMock = {
  player: {
    findUnique: vi.fn(async () => existingPlayer),
    create: vi.fn(async () => existingPlayer),
    update: vi.fn(async () => existingPlayer),
    updateMany: vi.fn(async () => ({ count: 0 })),
  },
}

vi.mock('../lib/prisma.js', () => ({
  prisma: prismaMock,
}))

const {
  getOrCreatePlayer,
  getCurrentPlayer,
  isPlayerProfileComplete,
  markAllPlayersOffline,
  ProfileServiceError,
  updatePlayerPresenceById,
  updatePlayerTimeZone,
  upsertPlayerProfile,
} = await import('./playerService.js')

// --- Tests ---

describe('isPlayerProfileComplete', () => {
  it('retourne true si tous les champs obligatoires sont présents', () => {
    expect(
      isPlayerProfileComplete({
        firstName: 'Awa',
        lastName: 'Diallo',
        birthDate: new Date(),
        username: 'awa',
      }),
    ).toBe(true)
  })

  it('retourne false si un champ est manquant', () => {
    expect(
      isPlayerProfileComplete({
        firstName: 'Awa',
        lastName: null,
        birthDate: new Date(),
        username: 'awa',
      }),
    ).toBe(false)
  })

  it('retourne false si username est absent', () => {
    expect(
      isPlayerProfileComplete({
        firstName: 'Awa',
        lastName: 'Diallo',
        birthDate: new Date(),
        username: null,
      }),
    ).toBe(false)
  })
})

describe('getOrCreatePlayer', () => {
  it('retourne le joueur existant sans appeler create', async () => {
    prismaMock.player.findUnique.mockResolvedValueOnce(existingPlayer)
    const player = await getOrCreatePlayer('clerk_123')
    expect(player.id).toBe('player_1')
    expect(prismaMock.player.create).not.toHaveBeenCalled()
  })

  it('crée un nouveau joueur si inexistant', async () => {
    prismaMock.player.findUnique.mockResolvedValueOnce(null as unknown as typeof existingPlayer)
    prismaMock.player.create.mockResolvedValueOnce({ ...existingPlayer, id: 'player_new' })
    const player = await getOrCreatePlayer('clerk_new')
    expect(prismaMock.player.create).toHaveBeenCalled()
    expect(player.id).toBe('player_new')
  })
})

describe('getCurrentPlayer', () => {
  it('retourne le joueur avec le nom complet construit depuis firstName + lastName', async () => {
    prismaMock.player.findUnique.mockResolvedValue(existingPlayer)
    prismaMock.player.update.mockResolvedValue(existingPlayer)
    const player = await getCurrentPlayer('clerk_123')
    expect(player.name).toBe('Awa Diallo')
  })
})

describe('upsertPlayerProfile', () => {
  it('rejette avec ProfileServiceError si le username est verrouillé et différent', async () => {
    prismaMock.player.findUnique.mockResolvedValue(existingPlayer)
    prismaMock.player.update.mockResolvedValue(existingPlayer)

    await expect(
      upsertPlayerProfile('clerk_123', {
        firstName: 'Awa',
        lastName: 'Diallo',
        birthDate: new Date(),
        username: 'autre_username',
      }),
    ).rejects.toBeInstanceOf(ProfileServiceError)
  })

  it('rejette avec code username_locked si le username existe et diffère', async () => {
    prismaMock.player.findUnique.mockResolvedValue(existingPlayer)
    prismaMock.player.update.mockResolvedValue(existingPlayer)

    const error = await upsertPlayerProfile('clerk_123', {
      firstName: 'Awa',
      lastName: 'Diallo',
      birthDate: new Date(),
      username: 'autre',
    }).catch((e) => e)

    expect(error).toBeInstanceOf(ProfileServiceError)
    expect((error as InstanceType<typeof ProfileServiceError>).code).toBe('username_locked')
  })

  it('accepte la mise à jour si le username est identique à celui déjà enregistré', async () => {
    prismaMock.player.findUnique.mockResolvedValue(existingPlayer)
    prismaMock.player.update.mockResolvedValue(existingPlayer)

    await expect(
      upsertPlayerProfile('clerk_123', {
        firstName: 'Awa',
        lastName: 'Diallo',
        birthDate: new Date(),
        username: 'awa',
        timeZone: 'America/New_York',
      }),
    ).resolves.toBeDefined()

    expect(prismaMock.player.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ timeZone: 'America/New_York' }),
      }),
    )
  })
  it('conserve l avatar existant si aucun avatarUrl nest fourni', async () => {
    const playerWithAvatar = { ...existingPlayer, avatarUrl: 'https://images.example/avatar.png' }
    prismaMock.player.findUnique.mockResolvedValue(playerWithAvatar)
    prismaMock.player.update.mockResolvedValue(playerWithAvatar)

    await upsertPlayerProfile('clerk_123', {
      firstName: 'Awa',
      lastName: 'Diallo',
      birthDate: new Date(),
      username: 'awa',
    })

    expect(prismaMock.player.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ avatarUrl: 'https://images.example/avatar.png' }),
      }),
    )
  })

  it('supprime l avatar si avatarUrl vaut null', async () => {
    const playerWithAvatar = { ...existingPlayer, avatarUrl: 'https://images.example/avatar.png' }
    prismaMock.player.findUnique.mockResolvedValue(playerWithAvatar)
    prismaMock.player.update.mockResolvedValue({ ...playerWithAvatar, avatarUrl: null })

    await upsertPlayerProfile('clerk_123', {
      firstName: 'Awa',
      lastName: 'Diallo',
      birthDate: new Date(),
      username: 'awa',
      avatarUrl: null,
    })

    expect(prismaMock.player.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ avatarUrl: null }),
      }),
    )
  })
})

describe('updatePlayerTimeZone', () => {
  it('met a jour uniquement le fuseau horaire du joueur', async () => {
    prismaMock.player.findUnique.mockResolvedValue(existingPlayer)
    prismaMock.player.update.mockResolvedValue({ ...existingPlayer, timeZone: 'America/Los_Angeles' })

    const player = await updatePlayerTimeZone('clerk_123', 'America/Los_Angeles')

    expect(player.timeZone).toBe('America/Los_Angeles')
    expect(prismaMock.player.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'player_1' },
        data: { timeZone: 'America/Los_Angeles' },
      }),
    )
  })
})

describe('markAllPlayersOffline', () => {
  it('reinitialise uniquement les presences encore actives au demarrage serveur', async () => {
    const now = new Date('2026-07-16T10:00:00.000Z')

    await markAllPlayersOffline(now)

    expect(prismaMock.player.updateMany).toHaveBeenCalledWith({
      where: { NOT: { presenceStatus: 'offline' } },
      data: { presenceStatus: 'offline', presenceUpdatedAt: now },
    })
  })
})

describe('updatePlayerPresenceById', () => {
  it('met a jour le statut de presence autoritatif du joueur', async () => {
    const updatedAt = new Date('2026-07-16T10:00:00.000Z')
    prismaMock.player.update.mockResolvedValue({ ...existingPlayer, presenceStatus: 'away', presenceUpdatedAt: updatedAt })

    const player = await updatePlayerPresenceById('player_1', 'away', updatedAt)

    expect(player.presenceStatus).toBe('away')
    expect(prismaMock.player.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'player_1' },
        data: { presenceStatus: 'away', presenceUpdatedAt: updatedAt },
      }),
    )
  })
})
