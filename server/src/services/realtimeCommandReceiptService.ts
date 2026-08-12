import { randomUUID } from 'node:crypto'
import type { Prisma } from '../generated/prisma/client.js'
import { prisma } from '../lib/prisma.js'

const COMMAND_LEASE_MS = 30_000
const COMMAND_WAIT_ATTEMPTS = 20
const COMMAND_WAIT_INTERVAL_MS = 100

export type StoredRealtimeCommandResponse = {
  ok: boolean
  data?: Prisma.JsonValue
  error?: {
    message: string
    status: number
    code: string | null
  }
}

type CommandIdentity = {
  playerId: string
  eventName: string
  commandId: string
  matchId?: string | null
}

export type RealtimeCommandClaim =
  | { kind: 'execute'; receiptId: string; ownerToken: string }
  | { kind: 'completed'; response: StoredRealtimeCommandResponse }
  | { kind: 'busy' }
  | { kind: 'conflict' }

function isExpectedUniqueConflict(error: unknown) {
  if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'P2002') {
    return false
  }

  const meta = 'meta' in error && error.meta && typeof error.meta === 'object'
    ? error.meta as Record<string, unknown>
    : null
  const driverAdapterError = meta?.driverAdapterError && typeof meta.driverAdapterError === 'object'
    ? meta.driverAdapterError as Record<string, unknown>
    : null
  const cause = driverAdapterError?.cause && typeof driverAdapterError.cause === 'object'
    ? driverAdapterError.cause as Record<string, unknown>
    : null
  const constraint = cause?.constraint && typeof cause.constraint === 'object'
    ? cause.constraint as Record<string, unknown>
    : null
  const target = meta?.target ?? constraint?.fields ?? null
  const normalizedTarget = (Array.isArray(target) ? target.map(String) : [String(target ?? '')])
    .join(':')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')

  return ['playerid', 'eventname', 'commandid'].every((field) => normalizedTarget.includes(field))
}

function storedResponse(value: Prisma.JsonValue | null): StoredRealtimeCommandResponse | null {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('ok' in value) || typeof value.ok !== 'boolean') {
    return null
  }

  return value as unknown as StoredRealtimeCommandResponse
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

async function readExistingCommand(identity: CommandIdentity, ownerToken: string): Promise<RealtimeCommandClaim> {
  for (let attempt = 0; attempt <= COMMAND_WAIT_ATTEMPTS; attempt += 1) {
    const receipt = await prisma.realtimeCommandReceipt.findUnique({
      where: {
        playerId_eventName_commandId: {
          playerId: identity.playerId,
          eventName: identity.eventName,
          commandId: identity.commandId,
        },
      },
    })

    if (!receipt) {
      return claimRealtimeCommand(identity, ownerToken)
    }

    if (receipt.matchId && identity.matchId && receipt.matchId !== identity.matchId) {
      return { kind: 'conflict' }
    }

    if (receipt.status === 'completed') {
      const response = storedResponse(receipt.response)
      return response ? { kind: 'completed', response } : { kind: 'conflict' }
    }

    const now = new Date()
    if (receipt.lockedUntil <= now) {
      const claimed = await prisma.realtimeCommandReceipt.updateMany({
        where: {
          id: receipt.id,
          status: 'processing',
          lockedUntil: { lte: now },
        },
        data: {
          ownerToken,
          lockedUntil: new Date(now.getTime() + COMMAND_LEASE_MS),
          matchId: identity.matchId ?? receipt.matchId,
        },
      })

      if (claimed.count === 1) {
        return { kind: 'execute', receiptId: receipt.id, ownerToken }
      }
    }

    if (attempt < COMMAND_WAIT_ATTEMPTS) {
      await wait(COMMAND_WAIT_INTERVAL_MS)
    }
  }

  return { kind: 'busy' }
}

export async function claimRealtimeCommand(identity: CommandIdentity, ownerToken: string = randomUUID()): Promise<RealtimeCommandClaim> {
  const now = new Date()

  try {
    const receipt = await prisma.realtimeCommandReceipt.create({
      data: {
        playerId: identity.playerId,
        matchId: identity.matchId ?? null,
        eventName: identity.eventName,
        commandId: identity.commandId,
        ownerToken,
        lockedUntil: new Date(now.getTime() + COMMAND_LEASE_MS),
      },
    })

    return { kind: 'execute', receiptId: receipt.id, ownerToken }
  } catch (error) {
    if (!isExpectedUniqueConflict(error)) {
      throw error
    }

    return readExistingCommand(identity, ownerToken)
  }
}

export async function completeRealtimeCommand(
  claim: Extract<RealtimeCommandClaim, { kind: 'execute' }>,
  response: StoredRealtimeCommandResponse,
) {
  const updated = await prisma.realtimeCommandReceipt.updateMany({
    where: {
      id: claim.receiptId,
      status: 'processing',
      ownerToken: claim.ownerToken,
    },
    data: {
      status: 'completed',
      response: response as unknown as Prisma.InputJsonValue,
      lockedUntil: new Date(),
    },
  })

  return updated.count === 1
}

export async function releaseRealtimeCommand(claim: Extract<RealtimeCommandClaim, { kind: 'execute' }>) {
  await prisma.realtimeCommandReceipt.deleteMany({
    where: {
      id: claim.receiptId,
      status: 'processing',
      ownerToken: claim.ownerToken,
    },
  })
}
