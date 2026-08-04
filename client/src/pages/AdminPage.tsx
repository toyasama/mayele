import { isReverificationCancelledError } from '@clerk/react/errors'
import { useReverification } from '@clerk/react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { PageFrame } from '../components/layout/PageFrame'
import { isE2EAuthBypassEnabled, useAuth } from '../context/auth'
import {
  api,
  ApiRequestError,
  type AdminOverviewData,
  type AdminUser,
  type AdminUsersData,
} from '../lib/api'
import '../styles/routes/admin.css'

type PendingAction = {
  kind: 'reset' | 'delete'
  user: AdminUser
}

type SensitiveAction = (playerId: string, confirmation: string) => Promise<unknown>

function formatDate(value: string | null, options: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' }) {
  if (!value) return 'Jamais'
  return new Intl.DateTimeFormat('fr-FR', options).format(new Date(value))
}

function actionLabel(action: string) {
  if (action === 'player.progress_reset') return 'Progression reinitialisee'
  if (action === 'player.account_deleted') return 'Compte supprime'
  return action
}

function workerLabel(worker: AdminOverviewData['workers']['outbox']) {
  if (worker.lastFailedAt) return 'A verifier'
  if (!worker.started) return 'Arrete'
  if (worker.running) return 'En cours'
  return 'Operationnel'
}

async function parseSensitiveResponse(response: unknown) {
  if (response instanceof Response) {
    return response.json() as Promise<{ success?: boolean; message?: string }>
  }
  return response as { success?: boolean; message?: string }
}

function AdminPageContent({ resetAction, deleteAction }: { resetAction: SensitiveAction; deleteAction: SensitiveAction }) {
  const { getToken, user: currentUser } = useAuth()
  const [overview, setOverview] = useState<AdminOverviewData | null>(null)
  const [usersData, setUsersData] = useState<AdminUsersData | null>(null)
  const [page, setPage] = useState(1)
  const [searchDraft, setSearchDraft] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [accessDenied, setAccessDenied] = useState(false)
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const [confirmation, setConfirmation] = useState('')
  const [actionBusy, setActionBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const loadData = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true)
    else setLoading(true)

    try {
      const [overviewResult, usersResult] = await Promise.allSettled([
        api.getAdminOverview(getToken),
        api.getAdminUsers(getToken, { page, pageSize: 20, search }),
      ])

      const failures = [overviewResult, usersResult]
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map((result) => result.reason as unknown)

      if (failures.some((failure) => failure instanceof ApiRequestError && failure.status === 403)) {
        setAccessDenied(true)
        return
      }

      if (overviewResult.status === 'fulfilled') setOverview(overviewResult.value)
      if (usersResult.status === 'fulfilled') setUsersData(usersResult.value)
      setAccessDenied(false)
      setError(failures.length
        ? failures.map((failure) => failure instanceof Error ? failure.message : 'Chargement partiel impossible.').join(' ')
        : null)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [getToken, page, search])

  useEffect(() => {
    void loadData()
  }, [loadData])

  useEffect(() => {
    if (!pendingAction) return

    const previousOverflow = document.body.style.overflow
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !actionBusy) {
        setPendingAction(null)
        setConfirmation('')
        setActionError(null)
      }
    }

    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [actionBusy, pendingAction])

  function submitSearch(event: FormEvent) {
    event.preventDefault()
    setPage(1)
    setSearch(searchDraft.trim())
  }

  function openAction(kind: PendingAction['kind'], user: AdminUser) {
    setConfirmation('')
    setActionError(null)
    setSuccessMessage(null)
    setPendingAction({ kind, user })
  }

  function closeAction() {
    if (actionBusy) return
    setPendingAction(null)
    setConfirmation('')
    setActionError(null)
  }

  async function confirmAction() {
    if (!pendingAction || confirmation !== pendingAction.user.confirmationValue || actionBusy) return

    setActionBusy(true)
    setActionError(null)

    try {
      const execute = pendingAction.kind === 'reset' ? resetAction : deleteAction
      const payload = await parseSensitiveResponse(await execute(pendingAction.user.id, confirmation))
      if (!payload?.success) throw new Error(payload?.message ?? 'L action administrative a echoue.')

      const message = pendingAction.kind === 'reset'
        ? `La progression de ${pendingAction.user.name} a ete reinitialisee.`
        : `Le compte de ${pendingAction.user.name} a ete supprime.`
      setPendingAction(null)
      setConfirmation('')
      setSuccessMessage(message)
      await loadData(true)
    } catch (actionFailure) {
      if (isReverificationCancelledError(actionFailure)) {
        setActionError('Confirmation d identite annulee. Aucune donnee n a ete modifiee.')
      } else {
        setActionError(actionFailure instanceof Error ? actionFailure.message : 'L action administrative a echoue.')
      }
    } finally {
      setActionBusy(false)
    }
  }

  if (accessDenied) {
    return (
      <PageFrame className="admin-page" surface="wide">
        <section className="admin-access-denied" role="alert">
          <span className="admin-kicker">Zone reservee</span>
          <h1>Acces administrateur requis</h1>
          <p>Ce compte n est pas present dans la liste blanche configuree sur le serveur.</p>
        </section>
      </PageFrame>
    )
  }

  if (loading && !overview) {
    return <div className="page-loading" role="status">Chargement du pilotage...</div>
  }

  return (
    <PageFrame className="admin-page" surface="wide">
      <header className="admin-header">
        <div>
          <span className="admin-kicker">Pilotage Mayele</span>
          <h1>Administration</h1>
          <p>Vue d ensemble de l activite, des comptes et des operations sensibles.</p>
        </div>
        <button className="admin-refresh-button" type="button" disabled={refreshing} onClick={() => void loadData(true)}>
          {refreshing ? 'Actualisation...' : 'Actualiser'}
        </button>
      </header>

      {error ? <div className="admin-alert error" role="alert">{error}</div> : null}
      {successMessage ? <div className="admin-alert success" role="status">{successMessage}</div> : null}

      {overview ? (
        <>
          <section className="admin-metrics" aria-label="Indicateurs principaux">
            <article className="admin-metric primary">
              <span>Utilisateurs inscrits</span>
              <strong>{overview.metrics.registeredUsers.toLocaleString('fr-FR')}</strong>
              <small>{overview.metrics.completeProfiles} profils complets</small>
            </article>
            <article className="admin-metric">
              <span>Nouveaux sur 7 jours</span>
              <strong>{overview.metrics.newUsersSevenDays.toLocaleString('fr-FR')}</strong>
              <small>Inscriptions recentes</small>
            </article>
            <article className="admin-metric">
              <span>Actifs maintenant</span>
              <strong>{overview.metrics.activeUsers.toLocaleString('fr-FR')}</strong>
              <small>Activite detectee sous 5 min</small>
            </article>
            <article className="admin-metric">
              <span>Sessions sur 24 h</span>
              <strong>{overview.metrics.sessionsLastDay.toLocaleString('fr-FR')}</strong>
              <small>{overview.metrics.totalSessions.toLocaleString('fr-FR')} au total</small>
            </article>
            <article className="admin-metric">
              <span>Defis sur 24 h</span>
              <strong>{overview.metrics.matchesLastDay.toLocaleString('fr-FR')}</strong>
              <small>Parties multijoueur creees</small>
            </article>
            <article className="admin-metric">
              <span>Parties solo actives</span>
              <strong>{overview.metrics.activeSoloRuns.toLocaleString('fr-FR')}</strong>
              <small>En cours ou finalisation</small>
            </article>
          </section>

          <section className="admin-operations" aria-labelledby="admin-operations-title">
            <div className="admin-section-heading">
              <div>
                <span className="admin-kicker">Sante technique</span>
                <h2 id="admin-operations-title">Operations</h2>
              </div>
              <span className="admin-server-time">Serveur : {formatDate(overview.serverTime)}</span>
            </div>
            <div className="admin-status-grid">
              <article>
                <span className="admin-status-dot healthy" aria-hidden="true" />
                <div><strong>Base de donnees</strong><span>Operationnelle</span></div>
              </article>
              <article>
                <span className={`admin-status-dot ${overview.operations.failedOutboxEvents ? 'warning' : 'healthy'}`} aria-hidden="true" />
                <div><strong>File d evenements</strong><span>{overview.operations.outboxBacklog} en attente, {overview.operations.failedOutboxEvents} en erreur</span></div>
              </article>
              <article>
                <span className={`admin-status-dot ${overview.workers.outbox.lastFailedAt ? 'warning' : 'healthy'}`} aria-hidden="true" />
                <div><strong>Worker temps reel</strong><span>{workerLabel(overview.workers.outbox)}</span></div>
              </article>
              <article>
                <span className={`admin-status-dot ${overview.workers.matchExpiration.lastFailedAt ? 'warning' : 'healthy'}`} aria-hidden="true" />
                <div><strong>Expiration des defis</strong><span>{workerLabel(overview.workers.matchExpiration)}</span></div>
              </article>
            </div>
            <p className="admin-last-activity">Derniere session jouee : {formatDate(overview.operations.latestActivityAt)}</p>
          </section>
        </>
      ) : null}

      <section className="admin-users" aria-labelledby="admin-users-title">
        <div className="admin-section-heading admin-users-heading">
          <div>
            <span className="admin-kicker">Comptes</span>
            <h2 id="admin-users-title">Utilisateurs</h2>
          </div>
          <form className="admin-search" role="search" onSubmit={submitSearch}>
            <label htmlFor="admin-user-search">Rechercher un utilisateur</label>
            <div>
              <input
                id="admin-user-search"
                type="search"
                value={searchDraft}
                placeholder="Pseudo, nom ou e-mail"
                onChange={(event) => setSearchDraft(event.target.value)}
              />
              <button type="submit">Rechercher</button>
            </div>
          </form>
        </div>

        {usersData?.users.length ? (
          <div className="admin-users-table-wrap">
            <table className="admin-users-table">
              <thead>
                <tr>
                  <th>Utilisateur</th>
                  <th>Age</th>
                  <th>Activite</th>
                  <th>Progression</th>
                  <th>Inscription</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {usersData.users.map((user) => {
                  const isSelf = user.clerkUserId === currentUser?.clerkUserId
                  return (
                    <tr key={user.id}>
                      <td data-label="Utilisateur">
                        <div className="admin-user-identity">
                          {user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : <span aria-hidden="true">{user.name.slice(0, 1).toUpperCase()}</span>}
                          <div>
                            <strong>{user.name}</strong>
                            <span>{user.username ? `@${user.username}` : 'Sans pseudo'} · {user.email ?? 'Sans e-mail'}</span>
                          </div>
                        </div>
                      </td>
                      <td data-label="Age">{user.age === null ? 'Non renseigne' : `${user.age} ans`}</td>
                      <td data-label="Activite"><span className={`admin-presence ${user.presenceStatus}`}>{user.presenceStatus}</span></td>
                      <td data-label="Progression">{user.totalXp} XP · {user.sessionsCount} sessions</td>
                      <td data-label="Inscription">{formatDate(user.createdAt, { dateStyle: 'medium' })}</td>
                      <td data-label="Actions">
                        <div className="admin-row-actions">
                          <button type="button" disabled={isSelf} onClick={() => openAction('reset', user)}>Reinitialiser</button>
                          <button className="danger" type="button" disabled={isSelf} onClick={() => openAction('delete', user)}>Supprimer</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="admin-empty">Aucun utilisateur ne correspond a cette recherche.</p>
        )}

        {usersData ? (
          <div className="admin-pagination" aria-label="Pagination des utilisateurs">
            <span>{usersData.pagination.total} utilisateur{usersData.pagination.total > 1 ? 's' : ''}</span>
            <div>
              <button type="button" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Precedent</button>
              <span>Page {usersData.pagination.page} / {usersData.pagination.totalPages}</span>
              <button type="button" disabled={page >= usersData.pagination.totalPages} onClick={() => setPage((current) => current + 1)}>Suivant</button>
            </div>
          </div>
        ) : null}
      </section>

      {overview ? (
        <section className="admin-audit" aria-labelledby="admin-audit-title">
          <div className="admin-section-heading">
            <div>
              <span className="admin-kicker">Tracabilite</span>
              <h2 id="admin-audit-title">Dernieres actions sensibles</h2>
            </div>
          </div>
          {overview.recentAudit.length ? (
            <ol>
              {overview.recentAudit.map((entry) => (
                <li key={entry.id}>
                  <span className="admin-audit-icon" aria-hidden="true" />
                  <div><strong>{actionLabel(entry.action)}</strong><span>{entry.targetLabel ?? 'Compte inconnu'}</span></div>
                  <time dateTime={entry.createdAt}>{formatDate(entry.createdAt)}</time>
                </li>
              ))}
            </ol>
          ) : <p className="admin-empty">Aucune action sensible journalisee.</p>}
        </section>
      ) : null}

      {pendingAction ? (
        <div className="admin-dialog-backdrop" role="presentation" onMouseDown={closeAction}>
          <section className="admin-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
            <span className="admin-dialog-symbol" aria-hidden="true">!</span>
            <span className="admin-kicker">Action irreversible</span>
            <h2 id="admin-dialog-title">
              {pendingAction.kind === 'reset' ? 'Reinitialiser la progression ?' : 'Supprimer definitivement ce compte ?'}
            </h2>
            <p>
              {pendingAction.kind === 'reset'
                ? 'Les sessions, recompenses et points XP seront effaces. Le profil et les relations sociales seront conserves.'
                : 'Le compte Clerk et toutes les donnees Mayele associees seront supprimes.'}
            </p>
            <label htmlFor="admin-confirmation">
              Pour confirmer, saisissez <code>{pendingAction.user.confirmationValue}</code>
            </label>
            <input
              id="admin-confirmation"
              autoFocus
              autoComplete="off"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
            <p className="admin-reverification-note">Clerk demandera ensuite votre mot de passe ou votre facteur de connexion.</p>
            {actionError ? <div className="admin-alert error" role="alert">{actionError}</div> : null}
            <div className="admin-dialog-actions">
              <button type="button" disabled={actionBusy} onClick={closeAction}>Annuler</button>
              <button
                className="danger"
                type="button"
                disabled={actionBusy || confirmation !== pendingAction.user.confirmationValue}
                onClick={() => void confirmAction()}
              >
                {actionBusy ? 'Verification...' : pendingAction.kind === 'reset' ? 'Confirmer la reinitialisation' : 'Confirmer la suppression'}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </PageFrame>
  )
}

function ClerkAdminPage() {
  const { getToken } = useAuth()
  const resetAction = useReverification((playerId: string, confirmation: string) =>
    api.resetAdminUserProgress(getToken, playerId, confirmation))
  const deleteAction = useReverification((playerId: string, confirmation: string) =>
    api.deleteAdminUser(getToken, playerId, confirmation))

  return <AdminPageContent resetAction={resetAction} deleteAction={deleteAction} />
}

function E2EAdminPage() {
  const { getToken } = useAuth()
  const resetAction = async (playerId: string, confirmation: string) =>
    api.resetAdminUserProgress(getToken, playerId, confirmation)
  const deleteAction = async (playerId: string, confirmation: string) =>
    api.deleteAdminUser(getToken, playerId, confirmation)

  return <AdminPageContent resetAction={resetAction} deleteAction={deleteAction} />
}

export function AdminPage() {
  return isE2EAuthBypassEnabled ? <E2EAdminPage /> : <ClerkAdminPage />
}
