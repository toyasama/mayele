import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { PageFrame } from '../components/layout/PageFrame'
import { ResponsiveTabs } from '../components/layout/ResponsiveTabs'
import { useAuth } from '../context/auth'
import { getRealtimePresence, useRealtimeEvents, type PresenceRealtimePayload } from '../hooks/useRealtimeEvents'
import { readCache, SOCIAL_CACHE_PREFIX, userCacheKey, writeCache } from '../lib/appCache'
import { api, type FriendRequestData, type PublicPlayer } from '../lib/api'
import type { PresenceStatus } from '../lib/api'
import { getPlayerProgress } from '../lib/game'

type SocialStatus = 'friend' | 'outgoing' | 'incoming'
type SocialFilter = 'all' | SocialStatus
type RelationTab = 'friends' | 'search'
type SocialOverview = {
  friends: PublicPlayer[]
  incoming: FriendRequestData[]
  outgoing: FriendRequestData[]
}

type SocialCard = {
  key: string
  status: SocialStatus
  player: PublicPlayer
  request?: FriendRequestData
}

const FILTERS: Array<{ key: SocialFilter; label: string }> = [
  { key: 'all', label: 'Tous' },
  { key: 'friend', label: 'Amis' },
  { key: 'outgoing', label: 'Envoyees' },
  { key: 'incoming', label: 'Recues' },
]

function playerInitials(player: PublicPlayer) {
  const source = player.name || player.username || 'Joueur'
  const parts = source.trim().split(/\s+/).slice(0, 2)
  return parts.map((part) => part[0]?.toUpperCase()).join('') || 'MJ'
}

function playerHandle(player: PublicPlayer) {
  return player.username ? `@${player.username}` : 'Profil Mayele'
}

function formatXp(value: number) {
  return new Intl.NumberFormat('fr-FR').format(value)
}

function playerLevel(player: PublicPlayer) {
  return getPlayerProgress(player.totalXp).level
}

function sortPlayers(players: PublicPlayer[]) {
  return [...players].sort((left, right) => left.name.localeCompare(right.name, 'fr'))
}

function statusLabel(status: SocialStatus | null) {
  if (status === 'friend') {
    return 'Ami'
  }

  if (status === 'outgoing') {
    return 'Demande envoyee'
  }

  if (status === 'incoming') {
    return 'Demande recue'
  }

  return 'Aucun lien'
}

function presenceLabel(status: PresenceStatus) {
  if (status === 'online') {
    return 'En ligne'
  }

  if (status === 'away') {
    return 'Absent'
  }

  return 'Hors ligne'
}

function PlayerAvatar({ player }: { player: PublicPlayer }) {
  if (player.avatarUrl) {
    return <img className="profile-card-avatar" src={player.avatarUrl} alt="" />
  }

  return (
    <span className="profile-card-avatar initials" aria-hidden="true">
      {playerInitials(player)}
    </span>
  )
}

function EmptyPanel({ title, text }: { title: string; text: string }) {
  return (
    <div className="friends-empty-panel">
      <strong>{title}</strong>
      <span>{text}</span>
    </div>
  )
}

function ProfileCard({
  player,
  status,
  children,
}: {
  player: PublicPlayer
  status: SocialStatus | null
  children?: ReactNode
}) {
  return (
    <article className={`profile-card ${status ? `status-${status}` : 'status-none'}`}>
      <span className={`profile-presence presence-${player.presenceStatus}`}>
        <span aria-hidden="true" />
        {presenceLabel(player.presenceStatus)}
      </span>
      <PlayerAvatar player={player} />
      <div className="profile-card-copy">
        <strong>{player.name}</strong>
        <span>{playerHandle(player)}</span>
      </div>
      <div className="profile-card-stats">
        <div>
          <span>Niveau</span>
          <strong>{playerLevel(player)}</strong>
        </div>
        <div>
          <span>XP</span>
          <strong>{formatXp(player.totalXp)}</strong>
        </div>
      </div>
      <span className="profile-status-pill">{statusLabel(status)}</span>
      {children ? <div className="profile-card-actions">{children}</div> : null}
    </article>
  )
}

function SearchPromptCard({
  query,
  searching,
  onQueryChange,
  onSubmit,
}: {
  query: string
  searching: boolean
  onQueryChange: (value: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  return (
    <article className="profile-card search-prompt-card">
      <div className="search-prompt-icon" aria-hidden="true">
        +
      </div>
      <div className="profile-card-copy">
        <strong>Rechercher un profil</strong>
        <span>Entrez un username</span>
      </div>
      <form className="card-search-form" onSubmit={onSubmit}>
        <label>
          Nom d'utilisateur
          <input autoComplete="off" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="ex: awa" />
        </label>
        <button className="primary-button" type="submit" disabled={searching}>
          {searching ? 'Recherche...' : 'Rechercher'}
        </button>
      </form>
    </article>
  )
}

export function FriendsPage() {
  const { getToken, isAuthenticated, user } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const cacheKey = user?.clerkUserId ? userCacheKey(SOCIAL_CACHE_PREFIX, user.clerkUserId) : null
  const cachedOverview = useMemo(() => (cacheKey ? readCache<SocialOverview>(cacheKey) : null), [cacheKey])
  const [friends, setFriends] = useState<PublicPlayer[]>(() => sortPlayers(cachedOverview?.friends ?? []))
  const [incomingRequests, setIncomingRequests] = useState<FriendRequestData[]>(() => cachedOverview?.incoming ?? [])
  const [outgoingRequests, setOutgoingRequests] = useState<FriendRequestData[]>(() => cachedOverview?.outgoing ?? [])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<PublicPlayer[]>([])
  const [activeTab, setActiveTab] = useState<RelationTab>('friends')
  const [activeFilter, setActiveFilter] = useState<SocialFilter>('all')
  const [loading, setLoading] = useState(!cachedOverview)
  const [searching, setSearching] = useState(false)
  const [actionId, setActionId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const realtimePresenceByPlayerIdRef = useRef(new Map<string, PresenceRealtimePayload['player']>())

  function showToast(title: string) {
    window.dispatchEvent(new CustomEvent('mayele:toast', { detail: { title, variant: 'success' } }))
  }

  const incomingByPlayerId = useMemo(() => new Map(incomingRequests.map((request) => [request.player.id, request])), [incomingRequests])
  const outgoingByPlayerId = useMemo(() => new Map(outgoingRequests.map((request) => [request.player.id, request])), [outgoingRequests])
  const friendIds = useMemo(() => new Set(friends.map((friend) => friend.id)), [friends])

  const socialCards = useMemo<SocialCard[]>(() => {
    const friendCards = friends.map((player) => ({ key: `friend:${player.id}`, status: 'friend' as const, player }))
    const outgoingCards = outgoingRequests.map((request) => ({
      key: `outgoing:${request.id}`,
      status: 'outgoing' as const,
      player: request.player,
      request,
    }))
    const incomingCards = incomingRequests.map((request) => ({
      key: `incoming:${request.id}`,
      status: 'incoming' as const,
      player: request.player,
      request,
    }))

    return [...incomingCards, ...outgoingCards, ...friendCards]
  }, [friends, incomingRequests, outgoingRequests])

  const filteredCards = useMemo(() => {
    return activeFilter === 'all' ? socialCards : socialCards.filter((card) => card.status === activeFilter)
  }, [activeFilter, socialCards])

  const filterCounts = useMemo(
    () => ({
      all: socialCards.length,
      friend: friends.length,
      outgoing: outgoingRequests.length,
      incoming: incomingRequests.length,
    }),
    [friends.length, incomingRequests.length, outgoingRequests.length, socialCards.length],
  )

  useEffect(() => {
    const filterParam = searchParams.get('filter')

    if (filterParam === 'incoming' || filterParam === 'outgoing' || filterParam === 'friend') {
      setActiveTab('friends')
      setActiveFilter(filterParam)
    }
  }, [searchParams])

  const patchPlayerWithRealtimePresence = useCallback((player: PublicPlayer) => {
    const realtimePresence = realtimePresenceByPlayerIdRef.current.get(player.id) ?? getRealtimePresence(player.id)

    if (!realtimePresence || Date.parse(realtimePresence.presenceUpdatedAt) < Date.parse(player.presenceUpdatedAt)) {
      return player
    }

    return {
      ...player,
      presenceStatus: realtimePresence.presenceStatus,
      presenceUpdatedAt: realtimePresence.presenceUpdatedAt,
    }
  }, [])

  const mergeRealtimePresence = useCallback((payload: SocialOverview): SocialOverview => ({
    friends: payload.friends.map(patchPlayerWithRealtimePresence),
    incoming: payload.incoming.map((request) => ({ ...request, player: patchPlayerWithRealtimePresence(request.player) })),
    outgoing: payload.outgoing.map((request) => ({ ...request, player: patchPlayerWithRealtimePresence(request.player) })),
  }), [patchPlayerWithRealtimePresence])

  const refreshSocialData = useCallback(async () => {
    const payload = mergeRealtimePresence(await api.getSocialOverview(getToken))

    setFriends(sortPlayers(payload.friends))
    setIncomingRequests(payload.incoming)
    setOutgoingRequests(payload.outgoing)
    if (cacheKey) {
      writeCache(cacheKey, payload)
    }
  }, [cacheKey, getToken, mergeRealtimePresence])

  const refreshSocialDataFromRealtime = useCallback(() => {
    void refreshSocialData().catch((caughtError) => {
      setError(caughtError instanceof Error ? caughtError.message : 'Impossible de synchroniser vos amis.')
    })
  }, [refreshSocialData])

  const applyRealtimePresence = useCallback((payload: PresenceRealtimePayload) => {
    const currentPresence = realtimePresenceByPlayerIdRef.current.get(payload.player.id)

    if (currentPresence && Date.parse(currentPresence.presenceUpdatedAt) > Date.parse(payload.player.presenceUpdatedAt)) {
      return
    }

    realtimePresenceByPlayerIdRef.current.set(payload.player.id, payload.player)
    const patchPlayer = (player: PublicPlayer) => {
      if (player.id !== payload.player.id) {
        return player
      }

      return {
        ...player,
        presenceStatus: payload.player.presenceStatus,
        presenceUpdatedAt: payload.player.presenceUpdatedAt,
      }
    }

    setFriends((current) => current.map(patchPlayer))
    setIncomingRequests((current) => current.map((request) => ({ ...request, player: patchPlayer(request.player) })))
    setOutgoingRequests((current) => current.map((request) => ({ ...request, player: patchPlayer(request.player) })))
    setSearchResults((current) => current.map(patchPlayer))
  }, [])

  const realtimeCommands = useRealtimeEvents({
    isAuthenticated,
    getToken,
    onSocialChanged: refreshSocialDataFromRealtime,
    onPresenceChanged: applyRealtimePresence,
  })

  useEffect(() => {
    if (!cachedOverview) {
      return
    }

    const payload = mergeRealtimePresence(cachedOverview)
    setFriends(sortPlayers(payload.friends))
    setIncomingRequests(payload.incoming)
    setOutgoingRequests(payload.outgoing)
    setLoading(false)
  }, [cachedOverview, mergeRealtimePresence])

  useEffect(() => {
    if (!cacheKey || loading) {
      return
    }

    writeCache<SocialOverview>(cacheKey, {
      friends,
      incoming: incomingRequests,
      outgoing: outgoingRequests,
    })
  }, [cacheKey, friends, incomingRequests, loading, outgoingRequests])

  useEffect(() => {
    if (!isAuthenticated) {
      return
    }

    let active = true

    setLoading(true)
    setError('')
    refreshSocialData()
      .catch((caughtError) => {
        if (active) {
          setError(caughtError instanceof Error ? caughtError.message : 'Impossible de charger vos amis.')
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [isAuthenticated, refreshSocialData])

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const query = searchQuery.trim()

    if (query.length < 2) {
      setError('Entrez au moins 2 caracteres.')
      setSearchResults([])
      return
    }

    setSearching(true)
    setError('')

    try {
      const payload = await api.searchPlayers(getToken, query)
      setSearchResults(payload.players)
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Recherche impossible.')
    } finally {
      setSearching(false)
    }
  }

  async function handleSendRequest(player: PublicPlayer) {
    setActionId(`send:${player.id}`)
    setError('')

    try {
      const payload = await api.sendFriendRequest(getToken, player.id)
      setOutgoingRequests((current) => [payload.request, ...current.filter((request) => request.player.id !== player.id)])
      showToast(`Demande envoyee a ${player.name}.`)
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Impossible d'envoyer la demande.")
    } finally {
      setActionId(null)
    }
  }

  async function handleCancelRequest(request: FriendRequestData) {
    setActionId(`cancel:${request.id}`)
    setError('')

    try {
      await api.cancelFriendRequest(getToken, request.id)
      setOutgoingRequests((current) => current.filter((item) => item.id !== request.id))
      showToast('Demande annulee.')
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Impossible d'annuler la demande.")
    } finally {
      setActionId(null)
    }
  }

  async function handleAcceptRequest(request: FriendRequestData) {
    setActionId(`accept:${request.id}`)
    setError('')

    try {
      const payload = await api.acceptFriendRequest(getToken, request.id)
      setFriends((current) => sortPlayers([payload.friend, ...current.filter((friend) => friend.id !== payload.friend.id)]))
      setIncomingRequests((current) => current.filter((item) => item.id !== request.id))
      showToast(`${payload.friend.name} est maintenant dans vos amis.`)
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Impossible d'accepter la demande.")
    } finally {
      setActionId(null)
    }
  }

  async function handleDeclineRequest(request: FriendRequestData) {
    setActionId(`decline:${request.id}`)
    setError('')

    try {
      await api.declineFriendRequest(getToken, request.id)
      setIncomingRequests((current) => current.filter((item) => item.id !== request.id))
      showToast('Demande refusee.')
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Impossible de refuser la demande.')
    } finally {
      setActionId(null)
    }
  }

  async function handleRemoveFriend(friend: PublicPlayer) {
    setActionId(`remove:${friend.id}`)
    setError('')

    try {
      await api.removeFriend(getToken, friend.id)
      setFriends((current) => current.filter((item) => item.id !== friend.id))
      showToast(`${friend.name} a ete retire de vos amis.`)
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Impossible de supprimer cet ami.")
    } finally {
      setActionId(null)
    }
  }

  async function handleCreateChallenge(friend: PublicPlayer) {
    setActionId(`challenge:${friend.id}`)
    setError('')

    try {
      const payload = await realtimeCommands.createMatchInvitation({
        opponentPlayerId: friend.id,
        game: 'mixte',
        level: 'debutant',
        practiceSkill: null,
        challengeMode: 'sprint',
        durationSeconds: 60,
      })
      showToast(`Defi sprint envoye a ${friend.name}.`)
      navigate(`/jeu/multijoueur?match=${encodeURIComponent(payload.match.id)}`)
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Impossible de creer ce defi.")
    } finally {
      setActionId(null)
    }
  }

  function searchStatus(player: PublicPlayer): SocialStatus | null {
    if (friendIds.has(player.id)) {
      return 'friend'
    }

    if (outgoingByPlayerId.has(player.id)) {
      return 'outgoing'
    }

    if (incomingByPlayerId.has(player.id)) {
      return 'incoming'
    }

    return null
  }

  return (
    <PageFrame className="friends-page" aria-busy={loading}>
      {error ? <div className="form-error">{error}</div> : null}

      <article className="card friends-panel profile-carousel-panel">
        <div className="friends-panel-heading">
          <div className="section-kicker compact-kicker">
            <span className="eyebrow">Relations</span>
            <h2>{activeTab === 'friends' ? 'Mes amis' : 'Rechercher'}</h2>
          </div>

          <ResponsiveTabs
            ariaLabel="Relations"
            className="relations-tab-bar"
            options={[
              { label: 'Mes amis', value: 'friends' },
              { label: 'Rechercher', value: 'search' },
            ]}
            value={activeTab}
            onChange={setActiveTab}
          />
        </div>

        {activeTab === 'friends' ? (
          <>
            <div className="friends-filter-bar" aria-label="Filtrer les profils">
              {FILTERS.map((filter) => (
                <button
                  key={filter.key}
                  type="button"
                  className={activeFilter === filter.key ? 'active' : ''}
                  aria-pressed={activeFilter === filter.key}
                  onClick={() => setActiveFilter(filter.key)}
                >
                  <span>{filter.label}</span>
                  <strong>{filterCounts[filter.key]}</strong>
                </button>
              ))}
            </div>

            {filteredCards.length ? (
              <div className="profile-card-scroller" aria-label="Profils amis et demandes">
                {filteredCards.map((card) => (
                  <ProfileCard key={card.key} player={card.player} status={card.status}>
                    {card.status === 'friend' ? (
                      <>
                        <button className="secondary-button" type="button" onClick={() => navigate(`/amis/${encodeURIComponent(card.player.id)}`)}>
                          Voir le profil
                        </button>
                        <button
                          className="primary-button"
                          type="button"
                          disabled={actionId === `challenge:${card.player.id}`}
                          onClick={() => void handleCreateChallenge(card.player)}
                        >
                          {actionId === `challenge:${card.player.id}` ? 'Envoi...' : 'Defier'}
                        </button>
                        <button
                          className="ghost-button danger-button"
                          type="button"
                          disabled={actionId === `remove:${card.player.id}`}
                          onClick={() => void handleRemoveFriend(card.player)}
                        >
                          {actionId === `remove:${card.player.id}` ? 'Retrait...' : 'Retirer'}
                        </button>
                      </>
                    ) : null}

                    {card.status === 'outgoing' && card.request ? (
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={actionId === `cancel:${card.request.id}`}
                        onClick={() => void handleCancelRequest(card.request!)}
                      >
                        {actionId === `cancel:${card.request.id}` ? 'Annulation...' : 'Annuler'}
                      </button>
                    ) : null}

                    {card.status === 'incoming' && card.request ? (
                      <>
                        <button
                          className="primary-button"
                          type="button"
                          disabled={actionId === `accept:${card.request.id}`}
                          onClick={() => void handleAcceptRequest(card.request!)}
                        >
                          {actionId === `accept:${card.request.id}` ? 'Validation...' : 'Accepter'}
                        </button>
                        <button
                          className="secondary-button"
                          type="button"
                          disabled={actionId === `decline:${card.request.id}`}
                          onClick={() => void handleDeclineRequest(card.request!)}
                        >
                          {actionId === `decline:${card.request.id}` ? 'Refus...' : 'Refuser'}
                        </button>
                      </>
                    ) : null}
                  </ProfileCard>
                ))}
              </div>
            ) : (
              <EmptyPanel title="Aucun profil" text="Les amis et demandes apparaissent ici." />
            )}
          </>
        ) : (
          <div className="profile-card-scroller search-card-scroller" aria-label="Resultats de recherche">
            <SearchPromptCard query={searchQuery} searching={searching} onQueryChange={setSearchQuery} onSubmit={handleSearch} />

            {searchResults.length ? (
              <>
                {searchResults.map((player) => {
                  const status = searchStatus(player)
                  const outgoingRequest = outgoingByPlayerId.get(player.id)
                  const incomingRequest = incomingByPlayerId.get(player.id)

                  return (
                    <ProfileCard key={player.id} player={player} status={status}>
                      {!status ? (
                        <button className="primary-button" type="button" disabled={actionId === `send:${player.id}`} onClick={() => void handleSendRequest(player)}>
                          {actionId === `send:${player.id}` ? 'Envoi...' : 'Ajouter ami'}
                        </button>
                      ) : null}

                      {status === 'outgoing' && outgoingRequest ? (
                        <button
                          className="secondary-button"
                          type="button"
                          disabled={actionId === `cancel:${outgoingRequest.id}`}
                          onClick={() => void handleCancelRequest(outgoingRequest)}
                        >
                          {actionId === `cancel:${outgoingRequest.id}` ? 'Annulation...' : 'Annuler'}
                        </button>
                      ) : null}

                      {status === 'incoming' && incomingRequest ? (
                        <>
                          <button
                            className="primary-button"
                            type="button"
                            disabled={actionId === `accept:${incomingRequest.id}`}
                            onClick={() => void handleAcceptRequest(incomingRequest)}
                          >
                            Accepter
                          </button>
                          <button
                            className="secondary-button"
                            type="button"
                            disabled={actionId === `decline:${incomingRequest.id}`}
                            onClick={() => void handleDeclineRequest(incomingRequest)}
                          >
                            Refuser
                          </button>
                        </>
                      ) : null}

                      {status === 'friend' ? (
                        <>
                          <button className="secondary-button" type="button" onClick={() => navigate(`/amis/${encodeURIComponent(player.id)}`)}>
                            Voir le profil
                          </button>
                          <button
                            className="primary-button"
                            type="button"
                            disabled={actionId === `challenge:${player.id}`}
                            onClick={() => void handleCreateChallenge(player)}
                          >
                            {actionId === `challenge:${player.id}` ? 'Envoi...' : 'Defier'}
                          </button>
                          <button
                            className="ghost-button danger-button"
                            type="button"
                            disabled={actionId === `remove:${player.id}`}
                            onClick={() => void handleRemoveFriend(player)}
                          >
                            Retirer
                          </button>
                        </>
                      ) : null}
                    </ProfileCard>
                  )
                })}
              </>
            ) : (
              <article className="profile-card search-empty-card">
                <div className="search-prompt-icon muted-icon" aria-hidden="true">
                  ...
                </div>
                <div className="profile-card-copy">
                  <strong>Aucun resultat</strong>
                  <span>Les profils trouves apparaitront ici.</span>
                </div>
              </article>
            )}
          </div>
        )}
      </article>
    </PageFrame>
  )
}
