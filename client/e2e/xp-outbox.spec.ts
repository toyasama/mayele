import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'

const API_URL = process.env.E2E_API_URL ?? 'http://127.0.0.1:4600'
const hostHeaders = { Authorization: 'Bearer e2e:e2e-host' }
const targetHeaders = { Authorization: 'Bearer e2e:e2e-target' }

function solve(prompt: string) {
  const [left, operator, right] = prompt.split(' ')
  const first = Number(left)
  const second = Number(right)
  if (operator === '+') return first + second
  if (operator === '-') return first - second
  if (operator === 'x') return first * second
  return first / second
}

test('le registre XP et la projection dashboard restent strictement alignés', async ({ request }) => {
  await request.post(`${API_URL}/api/e2e/reset-multiplayer`).then((response) => expect(response.ok()).toBe(true))

  const start = await request.post(`${API_URL}/api/solo-runs`, {
    headers: hostHeaders,
    data: {
      clientRunId: randomUUID(),
      mode: 'tempo',
      game: 'addition',
      level: 'debutant',
      practiceSkill: null,
      sprintDurationSeconds: 60,
      tempoQuestionCount: 10,
      tempoQuestionSeconds: 10,
    },
  })
  const started = await start.json()
  const question = started.run.question as { index: number; prompt: string }
  await request.post(`${API_URL}/api/solo-runs/${started.run.id}/answers`, {
    headers: hostHeaders,
    data: { questionIndex: question.index, userAnswer: solve(question.prompt) },
  })
  const finish = await request.post(`${API_URL}/api/solo-runs/${started.run.id}/finish`, { headers: hostHeaders })
  expect(finish.ok()).toBe(true)
  const receipt = await finish.json()

  const [dashboardResponse, ledgerResponse] = await Promise.all([
    request.get(`${API_URL}/api/dashboard`, { headers: hostHeaders }),
    request.get(`${API_URL}/api/e2e/player-ledger/e2e-host`),
  ])
  const dashboard = await dashboardResponse.json()
  const ledger = await ledgerResponse.json() as {
    totalXp: number
    xpLedgerEntries: Array<{ sourceType: string; sourceId: string; amount: number }>
  }
  const ledgerTotal = ledger.xpLedgerEntries.reduce((sum, entry) => sum + entry.amount, 0)

  expect(ledger.xpLedgerEntries.some((entry) => entry.sourceType === 'session' && entry.sourceId === receipt.run.result.sessionId)).toBe(true)
  expect(ledgerTotal).toBe(ledger.totalXp)
  expect(dashboard.summary.totalXp).toBe(ledger.totalXp)
  expect(receipt.run.result.playerProgress.totalXp).toBe(ledger.totalXp)
})

test('une demande d’ami commit notification et événements outbox avant diffusion', async ({ request }) => {
  const reset = await request.post(`${API_URL}/api/e2e/reset-multiplayer`)
  const resetPayload = await reset.json()
  const targetId = resetPayload.players.target.id as string

  const sent = await request.post(`${API_URL}/api/friends/requests`, {
    headers: hostHeaders,
    data: { receiverPlayerId: targetId },
  })
  expect(sent.status()).toBe(201)
  const sentPayload = await sent.json()
  const requestId = sentPayload.request.id as string

  const [requestsResponse, notificationsResponse] = await Promise.all([
    request.get(`${API_URL}/api/friends/requests`, { headers: targetHeaders }),
    request.get(`${API_URL}/api/notifications`, { headers: targetHeaders }),
  ])
  const requests = await requestsResponse.json()
  const notifications = await notificationsResponse.json()
  expect(requests.incoming).toContainEqual(expect.objectContaining({ id: requestId }))
  expect(notifications.notifications).toContainEqual(expect.objectContaining({
    dedupeKey: `friend_request:${requestId}:received`,
  }))

  await expect.poll(async () => {
    const response = await request.get(`${API_URL}/api/e2e/outbox/${requestId}`)
    const payload = await response.json()
    return payload.events
  }).toEqual([
    expect.objectContaining({ topic: 'social.changed', status: 'published', attempts: 1 }),
    expect.objectContaining({ topic: 'notification.created', status: 'published', attempts: 1 }),
  ])

  await request.post(`${API_URL}/api/friends/requests`, {
    headers: hostHeaders,
    data: { receiverPlayerId: targetId },
  }).then((response) => expect(response.status()).toBe(409))

  const outboxAfterRetry = await request.get(`${API_URL}/api/e2e/outbox/${requestId}`)
  expect((await outboxAfterRetry.json()).events).toHaveLength(2)

  const accepted = await request.post(`${API_URL}/api/friends/requests/${requestId}/accept`, {
    headers: targetHeaders,
  })
  expect(accepted.ok()).toBe(true)

  await expect.poll(async () => {
    const response = await request.get(`${API_URL}/api/e2e/outbox/${requestId}`)
    const payload = await response.json()
    return payload.events.map((event: { topic: string; status: string }) => ({
      topic: event.topic,
      status: event.status,
    }))
  }).toEqual([
    { topic: 'social.changed', status: 'published' },
    { topic: 'notification.created', status: 'published' },
    { topic: 'social.changed', status: 'published' },
    { topic: 'notification.created', status: 'published' },
    { topic: 'notifications.changed', status: 'published' },
  ])

  const [hostFriendsResponse, targetFriendsResponse, hostNotificationsResponse, targetNotificationsResponse] = await Promise.all([
    request.get(`${API_URL}/api/friends`, { headers: hostHeaders }),
    request.get(`${API_URL}/api/friends`, { headers: targetHeaders }),
    request.get(`${API_URL}/api/notifications`, { headers: hostHeaders }),
    request.get(`${API_URL}/api/notifications`, { headers: targetHeaders }),
  ])
  expect((await hostFriendsResponse.json()).friends).toContainEqual(expect.objectContaining({ id: targetId }))
  expect((await targetFriendsResponse.json()).friends).toContainEqual(expect.objectContaining({ username: 'alice-host' }))
  expect((await hostNotificationsResponse.json()).notifications).toContainEqual(expect.objectContaining({
    dedupeKey: `friend_request:${requestId}:accepted`,
  }))
  expect((await targetNotificationsResponse.json()).notifications).not.toContainEqual(expect.objectContaining({
    dedupeKey: `friend_request:${requestId}:received`,
  }))
})

test('le cycle social complet et les actions de notification restent atomiques', async ({ request }) => {
  const reset = await request.post(`${API_URL}/api/e2e/reset-multiplayer`)
  const resetPayload = await reset.json()
  const hostId = resetPayload.players.host.id as string
  const targetId = resetPayload.players.target.id as string

  const sendRequest = () => request.post(`${API_URL}/api/friends/requests`, {
    headers: hostHeaders,
    data: { receiverPlayerId: targetId },
  })

  const firstSent = await sendRequest()
  expect(firstSent.status()).toBe(201)
  const requestId = (await firstSent.json()).request.id as string

  const declined = await request.post(`${API_URL}/api/friends/requests/${requestId}/decline`, {
    headers: targetHeaders,
  })
  expect(declined.ok()).toBe(true)

  expect((await sendRequest()).status()).toBe(201)
  const cancelled = await request.post(`${API_URL}/api/friends/requests/${requestId}/cancel`, {
    headers: hostHeaders,
  })
  expect(cancelled.ok()).toBe(true)

  expect((await sendRequest()).status()).toBe(201)
  const accepted = await request.post(`${API_URL}/api/friends/requests/${requestId}/accept`, {
    headers: targetHeaders,
  })
  expect(accepted.ok()).toBe(true)

  const removed = await request.delete(`${API_URL}/api/friends/${targetId}`, { headers: hostHeaders })
  expect(removed.status()).toBe(204)
  const friendshipAggregateId = [hostId, targetId].sort().join(':')

  await expect.poll(async () => {
    const response = await request.get(`${API_URL}/api/e2e/outbox/${requestId}`)
    const payload = await response.json()
    return payload.events.filter((event: { status: string }) => event.status === 'published').length
  }).toBe(13)
  await expect.poll(async () => {
    const response = await request.get(`${API_URL}/api/e2e/outbox/${friendshipAggregateId}`)
    const payload = await response.json()
    return payload.events
  }).toEqual([
    expect.objectContaining({ topic: 'social.changed', status: 'published', attempts: 1 }),
  ])

  const hostNotificationsResponse = await request.get(`${API_URL}/api/notifications`, { headers: hostHeaders })
  const hostNotifications = await hostNotificationsResponse.json()
  const acceptedNotification = hostNotifications.notifications.find((notification: { dedupeKey: string }) =>
    notification.dedupeKey === `friend_request:${requestId}:accepted`)
  expect(acceptedNotification).toBeTruthy()

  const read = await request.put(`${API_URL}/api/notifications/${acceptedNotification.id}/read`, { headers: hostHeaders })
  expect(read.ok()).toBe(true)
  const dismissed = await request.delete(`${API_URL}/api/notifications/${acceptedNotification.id}`, { headers: hostHeaders })
  expect(dismissed.ok()).toBe(true)

  await expect.poll(async () => {
    const response = await request.get(`${API_URL}/api/e2e/outbox/${acceptedNotification.id}`)
    const payload = await response.json()
    return payload.events.map((event: { topic: string; status: string }) => ({
      topic: event.topic,
      status: event.status,
    }))
  }).toEqual([
    { topic: 'notifications.changed', status: 'published' },
    { topic: 'notifications.changed', status: 'published' },
  ])
})

test('le reset E2E restaure un graphe social, une outbox et un registre XP deterministes', async ({ request }) => {
  const firstReset = await request.post(`${API_URL}/api/e2e/reset-multiplayer`)
  expect(firstReset.ok()).toBe(true)
  const firstResetPayload = await firstReset.json()
  const targetId = firstResetPayload.players.target.id as string

  const initialLedgerResponse = await request.get(`${API_URL}/api/e2e/player-ledger/e2e-host`)
  expect(initialLedgerResponse.ok()).toBe(true)
  const initialLedger = await initialLedgerResponse.json() as {
    totalXp: number
    xpLedgerEntries: Array<{ sourceType: string; sourceId: string; amount: number }>
  }

  const sent = await request.post(`${API_URL}/api/friends/requests`, {
    headers: hostHeaders,
    data: { receiverPlayerId: targetId },
  })
  expect(sent.status()).toBe(201)
  const requestId = (await sent.json()).request.id as string

  await expect.poll(async () => {
    const response = await request.get(`${API_URL}/api/e2e/outbox/${requestId}`)
    return (await response.json()).events.length
  }).toBe(2)

  const secondReset = await request.post(`${API_URL}/api/e2e/reset-multiplayer`)
  expect(secondReset.ok()).toBe(true)

  const [
    targetRequestsResponse,
    targetNotificationsResponse,
    hostFriendsResponse,
    staleOutboxResponse,
    restoredLedgerResponse,
  ] = await Promise.all([
    request.get(`${API_URL}/api/friends/requests`, { headers: targetHeaders }),
    request.get(`${API_URL}/api/notifications`, { headers: targetHeaders }),
    request.get(`${API_URL}/api/friends`, { headers: hostHeaders }),
    request.get(`${API_URL}/api/e2e/outbox/${requestId}`),
    request.get(`${API_URL}/api/e2e/player-ledger/e2e-host`),
  ])

  expect((await targetRequestsResponse.json()).incoming).toEqual([])
  expect((await targetNotificationsResponse.json()).notifications).toEqual([])
  expect((await hostFriendsResponse.json()).friends.map((friend: { username: string }) => friend.username)).toEqual([
    'bob-guest',
  ])
  expect((await staleOutboxResponse.json()).events).toEqual([])

  const restoredLedger = await restoredLedgerResponse.json()
  expect(restoredLedger).toEqual(initialLedger)
  expect(restoredLedger.xpLedgerEntries.reduce(
    (sum: number, entry: { amount: number }) => sum + entry.amount,
    0,
  )).toBe(restoredLedger.totalXp)
})
