import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'
import { resolveApiBase } from './runtimeConfig'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('resolveApiBase', () => {
  it('uses the Vite proxy when a local API URL is opened from another device', () => {
    expect(resolveApiBase('http://localhost:4000/api', '192.168.1.14')).toBe('/api')
  })

  it('keeps the local API URL when the app runs on the same machine', () => {
    expect(resolveApiBase('http://localhost:4000/api', 'localhost')).toBe('http://localhost:4000/api')
  })

  it('keeps production API URLs', () => {
    expect(resolveApiBase('https://api.mayele-learning.com/api', 'mayele-learning.com', { isProduction: true })).toBe(
      'https://api.mayele-learning.com/api',
    )
  })

  it('fails fast when the production API URL is missing', () => {
    expect(() => resolveApiBase(undefined, 'mayele-learning.com', { isProduction: true })).toThrow('VITE_API_URL')
  })

  it('fails fast when the production API URL does not target /api', () => {
    expect(() => resolveApiBase('https://api.mayele-learning.com', 'mayele-learning.com', { isProduction: true })).toThrow(
      '/api',
    )
  })
})

describe('API GET request coalescing', () => {
  it('relance automatiquement un GET apres une erreur serveur transitoire', async () => {
    vi.useFakeTimers()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Erreur serveur.', code: 'internal_error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ summary: { sessions: 12 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
    vi.stubGlobal('fetch', fetchMock)

    const request = api.getDashboard(async () => 'token')
    await vi.advanceTimersByTimeAsync(250)

    await expect(request).resolves.toEqual({ summary: { sessions: 12 } })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('partage une requete GET identique deja en cours', async () => {
    let resolveResponse!: (response: Response) => void
    const responsePromise = new Promise<Response>((resolve) => {
      resolveResponse = resolve
    })
    const fetchMock = vi.fn(() => responsePromise)
    vi.stubGlobal('fetch', fetchMock)
    const getToken = vi.fn(async () => 'token')

    const first = api.getDashboard(getToken)
    const second = api.getDashboard(getToken)
    await Promise.resolve()
    resolveResponse(new Response(JSON.stringify({ summary: {} }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await expect(Promise.all([first, second])).resolves.toEqual([
      { summary: {} },
      { summary: {} },
    ])
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('relance le GET apres la fin de la requete precedente', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ notifications: [], unreadCount: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const getToken = vi.fn(async () => 'token')

    await api.getNotifications(getToken)
    await api.getNotifications(getToken)

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('ne partage jamais une requete entre deux sessions authentifiees', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ notifications: [], unreadCount: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await Promise.all([
      api.getNotifications(async () => 'token-a'),
      api.getNotifications(async () => 'token-b'),
    ])

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('authoritative solo commands', () => {
  it('starts a run with a stable command id, then sends only the answer choice', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      run: { id: 'run-1' },
      correction: null,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const clientRunId = '1c5eff21-1818-45f9-bcb0-a2dd0abe66f9'

    await api.startSoloRun(async () => 'token', {
      clientRunId,
      mode: 'tempo',
      game: 'addition',
      level: 'debutant',
      practiceSkill: null,
      sprintDurationSeconds: 60,
      tempoQuestionCount: 10,
      tempoQuestionSeconds: 10,
    })
    await api.submitSoloAnswer(async () => 'token', 'run-1', { questionIndex: 0, userAnswer: 4 })

    const startRequest = fetchMock.mock.calls[0]?.[1]
    const answerRequest = fetchMock.mock.calls[1]?.[1]
    expect(JSON.parse(String(startRequest?.body))).toMatchObject({ clientRunId })
    expect(JSON.parse(String(answerRequest?.body))).toEqual({ questionIndex: 0, userAnswer: 4 })
  })
})
