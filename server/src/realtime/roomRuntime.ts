import { randomUUID } from 'node:crypto'
import type { Server, Socket } from 'socket.io'
import type { SerializedMatch } from '../services/matchPresenter.js'

export type RoomRuntimeEvent = {
  roomId: string
  matchId: string
  eventId: string
  revision: number
  type: string
  reason: string
  serverTime: string
  match: SerializedMatch
}

type RuntimeRoom = {
  roomId: string
  revision: number
  latestMatch: SerializedMatch
  events: RoomRuntimeEvent[]
  commandEvents: Map<string, RoomRuntimeEvent>
}

const roomsByRoomId = new Map<string, RuntimeRoom>()
const roomIdByMatchId = new Map<string, string>()
const eventByCommandId = new Map<string, RoomRuntimeEvent>()
const MAX_EVENTS_PER_ROOM = 200

export function roomChannel(roomId: string) {
  return `room:${roomId}`
}

function matchRoomId(match: SerializedMatch) {
  return match.roomId ?? match.id
}

function snapshotForEmit(match: SerializedMatch): SerializedMatch {
  return { ...match, serverNow: new Date().toISOString() }
}

function runtimeRoomFor(match: SerializedMatch) {
  const roomId = matchRoomId(match)
  const current = roomsByRoomId.get(roomId)

  if (current) {
    current.latestMatch = match
    roomIdByMatchId.set(match.id, roomId)
    return current
  }

  const room: RuntimeRoom = {
    roomId,
    revision: 0,
    latestMatch: match,
    events: [],
    commandEvents: new Map(),
  }
  roomsByRoomId.set(roomId, room)
  roomIdByMatchId.set(match.id, roomId)
  return room
}

export function observeRoomSnapshot(match: SerializedMatch) {
  runtimeRoomFor(match)
}

export function recordRoomEvent(match: SerializedMatch, reason: string, commandId?: string | null) {
  const room = runtimeRoomFor(match)

  if (commandId) {
    const existing = eventByCommandId.get(commandId) ?? room.commandEvents.get(commandId)

    if (existing) {
      return existing
    }
  }

  room.revision += 1
  room.latestMatch = match

  const event: RoomRuntimeEvent = {
    roomId: room.roomId,
    matchId: match.id,
    eventId: randomUUID(),
    revision: room.revision,
    type: reason,
    reason,
    serverTime: new Date().toISOString(),
    match,
  }

  room.events.push(event)

  if (room.events.length > MAX_EVENTS_PER_ROOM) {
    room.events.splice(0, room.events.length - MAX_EVENTS_PER_ROOM)
  }

  if (commandId) {
    room.commandEvents.set(commandId, event)
    eventByCommandId.set(commandId, event)
  }

  return event
}

export function findRoomEventByCommandId(commandId: string | null | undefined) {
  if (!commandId) {
    return null
  }

  return eventByCommandId.get(commandId) ?? null
}

export function joinSocketToRoom(socket: Socket, roomId: string, afterEventId?: string | null) {
  const room = roomsByRoomId.get(roomId) ?? (roomIdByMatchId.get(roomId) ? roomsByRoomId.get(roomIdByMatchId.get(roomId)!) : null)

  socket.join(roomChannel(room?.roomId ?? roomId))

  if (!room) {
    return null
  }

  if (!afterEventId) {
    socket.emit('room:snapshot', {
      roomId: room.roomId,
      matchId: room.latestMatch.id,
      revision: room.revision,
      match: snapshotForEmit(room.latestMatch),
      serverTime: new Date().toISOString(),
    })
    return room
  }

  const eventIndex = room.events.findIndex((event) => event.eventId === afterEventId)

  if (eventIndex < 0) {
    socket.emit('room:snapshot', {
      roomId: room.roomId,
      matchId: room.latestMatch.id,
      revision: room.revision,
      match: snapshotForEmit(room.latestMatch),
      serverTime: new Date().toISOString(),
    })
    return room
  }

  for (const event of room.events.slice(eventIndex + 1)) {
    socket.emit('room:event', event)
  }

  return room
}

export function broadcastRoomEvent(io: Server, event: RoomRuntimeEvent, participantPlayerIds: string[], playerRoom: (playerId: string) => string) {
  for (const playerId of participantPlayerIds) {
    io.to(playerRoom(playerId)).socketsJoin(roomChannel(event.roomId))
  }

  io.to(roomChannel(event.roomId)).emit('room:event', event)
}

export function clearRoomRuntimeState() {
  roomsByRoomId.clear()
  roomIdByMatchId.clear()
  eventByCommandId.clear()
}
