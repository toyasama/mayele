import { getClerkUser } from '../middleware/auth.js'
import { prisma } from '../lib/prisma.js'

function displayNameFromEmail(email: string | null | undefined) {
  const localPart = email?.split('@')[0]?.replace(/[._-]+/g, ' ').trim()

  if (!localPart) {
    return null
  }

  return localPart.replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function displayNameFromClerk(user: Awaited<ReturnType<typeof getClerkUser>>) {
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim()
  return fullName || user.username || displayNameFromEmail(user.primaryEmailAddress?.emailAddress) || 'Joueur Mayele'
}

export async function getOrCreatePlayer(clerkUserId: string) {
  const existingPlayer = await prisma.player.findUnique({ where: { clerkUserId } })

  if (existingPlayer) {
    return existingPlayer
  }

  const clerkUser = await getClerkUser(clerkUserId)

  return prisma.player.create({
    data: {
      clerkUserId,
      email: clerkUser.primaryEmailAddress?.emailAddress ?? null,
      name: displayNameFromClerk(clerkUser),
    },
  })
}

export async function syncPlayerProfile(clerkUserId: string) {
  const clerkUser = await getClerkUser(clerkUserId)

  return prisma.player.upsert({
    where: { clerkUserId },
    update: {
      email: clerkUser.primaryEmailAddress?.emailAddress ?? null,
      name: displayNameFromClerk(clerkUser),
    },
    create: {
      clerkUserId,
      email: clerkUser.primaryEmailAddress?.emailAddress ?? null,
      name: displayNameFromClerk(clerkUser),
    },
  })
}
