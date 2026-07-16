export const PRESENCE_STATUSES = ['online', 'away', 'offline'] as const

export type PresenceStatus = (typeof PRESENCE_STATUSES)[number]

export function presenceStatusForSockets(socketCount: number, activeSocketCount: number): PresenceStatus {
  if (socketCount === 0) {
    return 'offline'
  }

  return activeSocketCount > 0 ? 'online' : 'away'
}
