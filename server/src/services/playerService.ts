import { getClerkUser } from '../middleware/auth.js'
import { normalizeTimeZone } from '../domain/daily.js'
import type { PresenceStatus } from '../domain/presence.js'
import { getClerkUserFromCache, invalidateClerkUserCache, setClerkUserInCache } from '../lib/clerkCache.js'
import { prisma } from '../lib/prisma.js'
import { invalidateDashboardCache } from './dashboardService.js'

export class ProfileServiceError extends Error {
  constructor(public readonly code: 'username_locked' | 'username_required') {
    super(code)
  }
}

export type ProfileUpsertInput = {
  firstName: string
  lastName: string
  birthDate: Date
  username?: string
  timeZone?: string
  avatarUrl?: string | null
}

function displayNameFromEmail(email: string | null | undefined) {
  const localPart = email?.split('@')[0]?.replace(/[._-]+/g, ' ').trim()

  if (!localPart) {
    return null
  }

  return localPart.replace(/\b\w/g, (letter) => letter.toUpperCase())
}

async function getCachedClerkUser(clerkUserId: string) {
  const cached = getClerkUserFromCache(clerkUserId)

  if (cached) {
    return cached
  }

  const user = await getClerkUser(clerkUserId)
  setClerkUserInCache(clerkUserId, user)
  return user
}

function displayNameFromClerk(user: Awaited<ReturnType<typeof getClerkUser>>) {
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim()
  return fullName || user.username || displayNameFromEmail(user.primaryEmailAddress?.emailAddress) || 'Joueur Mayele'
}

function avatarUrlFromClerk(user: Awaited<ReturnType<typeof getClerkUser>>) {
  return user.hasImage ? user.imageUrl : null
}

function profileDisplayName(firstName: string | null, lastName: string | null, fallbackName: string) {
  const candidate = [firstName, lastName].filter(Boolean).join(' ').trim()
  return candidate || fallbackName
}

export function isPlayerProfileComplete(player: {
  firstName: string | null
  lastName: string | null
  birthDate: Date | null
  username: string | null
}) {
  return Boolean(player.firstName && player.lastName && player.birthDate && player.username)
}

export async function getOrCreatePlayer(clerkUserId: string) {
  const existingPlayer = await prisma.player.findUnique({ where: { clerkUserId } })

  if (existingPlayer) {
    return existingPlayer
  }

  const clerkUser = await getCachedClerkUser(clerkUserId)

  return prisma.player.create({
    data: {
      clerkUserId,
      email: clerkUser.primaryEmailAddress?.emailAddress ?? null,
      name: displayNameFromClerk(clerkUser),
      avatarUrl: avatarUrlFromClerk(clerkUser),
    },
  })
}

export async function syncPlayerProfile(clerkUserId: string) {
  const existingPlayer = await prisma.player.findUnique({ where: { clerkUserId } })
  const clerkUser = await getCachedClerkUser(clerkUserId)
  const fallbackName = displayNameFromClerk(clerkUser)

  if (existingPlayer) {
    const hasProfileName = Boolean(existingPlayer.firstName || existingPlayer.lastName)
    const email = clerkUser.primaryEmailAddress?.emailAddress ?? null
    const name = hasProfileName ? profileDisplayName(existingPlayer.firstName, existingPlayer.lastName, existingPlayer.name) : fallbackName
    const avatarUrl = avatarUrlFromClerk(clerkUser)

    if (existingPlayer.email === email && existingPlayer.name === name && existingPlayer.avatarUrl === avatarUrl) {
      return existingPlayer
    }

    return prisma.player.update({
      where: { id: existingPlayer.id },
      data: {
        email,
        name,
        avatarUrl,
      },
    })
  }

  return prisma.player.create({
    data: {
      clerkUserId,
      email: clerkUser.primaryEmailAddress?.emailAddress ?? null,
      name: fallbackName,
      avatarUrl: avatarUrlFromClerk(clerkUser),
    },
  })
}

export async function getCurrentPlayer(clerkUserId: string) {
  const player = await getOrCreatePlayer(clerkUserId)

  if (player.firstName || player.lastName) {
    return {
      ...player,
      name: profileDisplayName(player.firstName, player.lastName, player.name),
    }
  }

  return player
}

export async function upsertPlayerProfile(clerkUserId: string, payload: ProfileUpsertInput) {
  const existingPlayer = await syncPlayerProfile(clerkUserId)
  const normalizedUsername = payload.username?.trim().toLowerCase()

  if (existingPlayer.username && normalizedUsername && existingPlayer.username !== normalizedUsername) {
    throw new ProfileServiceError('username_locked')
  }

  if (!existingPlayer.username && !normalizedUsername) {
    throw new ProfileServiceError('username_required')
  }

  const firstName = payload.firstName.trim()
  const lastName = payload.lastName.trim()
  const player = await prisma.player.update({
    where: { id: existingPlayer.id },
    data: {
      firstName,
      lastName,
      birthDate: payload.birthDate,
      username: existingPlayer.username ?? normalizedUsername,
      timeZone: normalizeTimeZone(payload.timeZone ?? existingPlayer.timeZone),
      avatarUrl: payload.avatarUrl === undefined ? existingPlayer.avatarUrl : payload.avatarUrl,
      name: `${firstName} ${lastName}`.trim(),
    },
  })

  // Invalider le cache Clerk pour forcer une resynchronisation au prochain accès
  invalidateClerkUserCache(clerkUserId)

  return player
}

export async function updatePlayerTimeZone(clerkUserId: string, timeZone: string) {
  const existingPlayer = await syncPlayerProfile(clerkUserId)

  const player = await prisma.player.update({
    where: { id: existingPlayer.id },
    data: { timeZone: normalizeTimeZone(timeZone) },
  })

  invalidateDashboardCache(player.id)
  return player
}

export async function updatePlayerPresenceById(playerId: string, presenceStatus: PresenceStatus, presenceUpdatedAt = new Date()) {
  return prisma.player.update({
    where: { id: playerId },
    data: {
      presenceStatus,
      presenceUpdatedAt,
    },
  })
}

export async function markAllPlayersOffline(presenceUpdatedAt = new Date()) {
  return prisma.player.updateMany({
    where: {
      NOT: { presenceStatus: 'offline' },
    },
    data: {
      presenceStatus: 'offline',
      presenceUpdatedAt,
    },
  })
}
