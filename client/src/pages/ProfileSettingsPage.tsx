import { useUser as useClerkUser } from '@clerk/react'
import { type ChangeEvent, type FormEvent, useEffect, useMemo, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { PageFrame } from '../components/layout/PageFrame'
import { ResponsiveTabs } from '../components/layout/ResponsiveTabs'
import { isE2EAuthBypassEnabled, useAuth } from '../context/auth'
import { useProfile } from '../context/profile-context'
import { api, type AuthUser } from '../lib/api'
import { dateInputLimit, formatDisplayName, isValidBirthDate, USERNAME_PATTERN } from '../lib/profile'
import { detectBrowserTimeZone, isValidTimeZone, timeZoneOptionsFor } from '../lib/timeZone'
import '../styles/routes/profile-settings.css'

type ProfileDraft = {
  firstName: string
  lastName: string
  birthDate: string
  username: string
  timeZone: string
}

type SettingsTab = 'profile' | 'system'

type LocationState = {
  profileDraft?: ProfileDraft
}

const MAX_AVATAR_SIZE = 5 * 1024 * 1024

function useE2EProfileImageUser() {
  return { user: null }
}

function useClerkProfileImageUser() {
  return useClerkUser()
}

// E2E renders the complete profile flow without mounting Clerk.
const useProfileImageUser = isE2EAuthBypassEnabled ? useE2EProfileImageUser : useClerkProfileImageUser

function initialDraftFromUser(user: AuthUser | null): ProfileDraft {
  return {
    firstName: user?.firstName ?? '',
    lastName: user?.lastName ?? '',
    birthDate: user?.birthDate ?? '',
    username: user?.username ?? '',
    timeZone: user?.timeZone ?? detectBrowserTimeZone(),
  }
}

function profileInitials(source: Pick<ProfileDraft, 'firstName' | 'lastName' | 'username'>) {
  const name = [source.firstName, source.lastName].filter(Boolean).join(' ').trim() || source.username || 'Mayele'
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'MJ'
}

function validateProfileDraft(draft: ProfileDraft, usernameLocked: boolean) {
  if (draft.firstName.trim().length < 2) {
    return 'Le prénom doit contenir au moins 2 caractères.'
  }

  if (draft.lastName.trim().length < 2) {
    return 'Le nom doit contenir au moins 2 caractères.'
  }

  if (!isValidBirthDate(draft.birthDate)) {
    return 'La date de naissance doit correspondre à un âge entre 6 et 120 ans.'
  }

  if (!usernameLocked && !USERNAME_PATTERN.test(draft.username.trim())) {
    return 'Le nom d’utilisateur doit contenir 3 à 24 caractères: lettres, chiffres ou underscore.'
  }

  return null
}

function validateSystemDraft(draft: ProfileDraft) {
  if (!isValidTimeZone(draft.timeZone)) {
    return 'Le fuseau horaire selectionne est invalide.'
  }

  return null
}

export function ProfileSettingsPage() {
  const { isAuthenticated, loading, getToken } = useAuth()
  const { profile: contextProfile, profileLoading, profileError, refreshProfile } = useProfile()
  const { user: clerkUser } = useProfileImageUser()
  const navigate = useNavigate()
  const location = useLocation()
  const locationState = (location.state as LocationState | null) ?? null

  // Initialiser le draft depuis le contexte partagé (pas de fetch dédié)
  const [draft, setDraft] = useState<ProfileDraft>(() =>
    locationState?.profileDraft
      ? { ...initialDraftFromUser(contextProfile), ...locationState.profileDraft }
      : initialDraftFromUser(contextProfile),
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null)
  const [avatarRemoved, setAvatarRemoved] = useState(false)
  const [activeTab, setActiveTab] = useState<SettingsTab>('profile')

  // Synchroniser le draft quand le contexte se charge pour la première fois
  const [draftSynced, setDraftSynced] = useState(false)
  useEffect(() => {
    if (draftSynced || profileLoading || !contextProfile) {
      return
    }

    const fromApi = initialDraftFromUser(contextProfile)
    setDraft(locationState?.profileDraft ? { ...fromApi, ...locationState.profileDraft } : fromApi)
    setDraftSynced(true)
  }, [contextProfile, draftSynced, locationState?.profileDraft, profileLoading])

  useEffect(() => {
    return () => {
      if (avatarPreviewUrl) {
        URL.revokeObjectURL(avatarPreviewUrl)
      }
    }
  }, [avatarPreviewUrl])

  const profile: AuthUser | null = contextProfile
  const bootLoading = false
  const previewAvatarUrl = avatarPreviewUrl ?? (avatarRemoved ? null : profile?.avatarUrl ?? null)

  const usernameLocked = Boolean(profile?.username)
  const profileComplete = Boolean(profile?.profileComplete)
  const maxBirthDate = useMemo(() => dateInputLimit('max'), [])
  const minBirthDate = useMemo(() => dateInputLimit('min'), [])
  const timeZoneOptions = useMemo(() => timeZoneOptionsFor(profile?.timeZone, draft.timeZone, detectBrowserTimeZone()), [draft.timeZone, profile?.timeZone])
  const baselineDraft = useMemo(() => initialDraftFromUser(profile), [profile])
  const profileDirty = avatarFile !== null
    || avatarRemoved
    || draft.firstName !== baselineDraft.firstName
    || draft.lastName !== baselineDraft.lastName
    || draft.birthDate !== baselineDraft.birthDate
    || (!usernameLocked && draft.username !== baselineDraft.username)
  const systemDirty = draft.timeZone !== baselineDraft.timeZone
  const canSubmitProfile = useMemo(() => {
    return !bootLoading && !saving && validateProfileDraft(draft, usernameLocked) === null
  }, [bootLoading, draft, saving, usernameLocked])
  const canSubmitSystem = useMemo(() => {
    return !bootLoading && !saving && validateSystemDraft(draft) === null
  }, [bootLoading, draft, saving])

  if (!loading && !isAuthenticated) {
    return <Navigate replace to="/connexion" />
  }

  if (loading || bootLoading) {
    return (
      <PageFrame className="narrow-page" surface="narrow">
        <div className="card loading-card">Chargement de votre profil...</div>
      </PageFrame>
    )
  }

  if (profileError && !profile) {
    return (
      <PageFrame className="narrow-page" surface="narrow">
        <div className="card loading-card">
          <p>{profileError}</p>
          <button className="ghost-button" type="button" onClick={() => void refreshProfile()}>
            Reessayer
          </button>
        </div>
      </PageFrame>
    )
  }

  function updateDraft(field: keyof ProfileDraft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }))
    setError('')
    setSuccess('')
  }

  function changeTab(tab: SettingsTab) {
    setActiveTab(tab)
    setError('')
    setSuccess('')
  }

  function handleAvatarChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null
    event.target.value = ''

    if (!file) {
      return
    }

    if (!file.type.startsWith('image/')) {
      setError('Choisissez un fichier image.')
      return
    }

    if (file.size > MAX_AVATAR_SIZE) {
      setError('La photo doit peser moins de 5 Mo.')
      return
    }

    if (avatarPreviewUrl) {
      URL.revokeObjectURL(avatarPreviewUrl)
    }

    setAvatarFile(file)
    setAvatarPreviewUrl(URL.createObjectURL(file))
    setAvatarRemoved(false)
    setError('')
    setSuccess('')
  }

  function handleRemoveAvatar() {
    if (avatarPreviewUrl) {
      URL.revokeObjectURL(avatarPreviewUrl)
    }

    setAvatarFile(null)
    setAvatarPreviewUrl(null)
    setAvatarRemoved(true)
    setError('')
    setSuccess('')
  }

  async function handleProfileSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const validationError = validateProfileDraft(draft, usernameLocked)

    if (validationError) {
      setError(validationError)
      return
    }

    setSaving(true)
    setError('')
    setSuccess('')

    try {
      let nextAvatarUrl: string | null | undefined

      if (avatarFile) {
        if (!clerkUser) {
          throw new Error('Connexion requise pour envoyer une photo.')
        }

        const image = await clerkUser.setProfileImage({ file: avatarFile })
        await clerkUser.reload()
        nextAvatarUrl = image.publicUrl ?? clerkUser.imageUrl ?? null
      } else if (avatarRemoved) {
        if (clerkUser?.hasImage) {
          await clerkUser.setProfileImage({ file: null })
          await clerkUser.reload()
        }

        nextAvatarUrl = null
      }

      const profilePayload = {
        firstName: draft.firstName.trim(),
        lastName: draft.lastName.trim(),
        birthDate: draft.birthDate,
        username: usernameLocked ? undefined : draft.username.trim().toLowerCase(),
        ...(nextAvatarUrl !== undefined ? { avatarUrl: nextAvatarUrl } : {}),
      }

      const payload = await api.updateProfile(getToken, profilePayload)

      setDraft(initialDraftFromUser(payload.user))
      setAvatarFile(null)
      if (avatarPreviewUrl) {
        URL.revokeObjectURL(avatarPreviewUrl)
        setAvatarPreviewUrl(null)
      }
      setAvatarRemoved(false)
      setDraftSynced(false)
      await refreshProfile()
      setSuccess('Profil mis à jour.')

      if (!profileComplete && payload.user.profileComplete) {
        navigate('/dashboard', { replace: true })
      }
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Impossible de mettre à jour votre profil.')
    } finally {
      setSaving(false)
    }
  }

  async function handleSystemSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const validationError = validateSystemDraft(draft)

    if (validationError) {
      setError(validationError)
      return
    }

    setSaving(true)
    setError('')
    setSuccess('')

    try {
      const payload = await api.updateTimeZone(getToken, draft.timeZone)
      setDraft((current) => ({ ...current, timeZone: payload.user.timeZone }))
      setDraftSynced(false)
      await refreshProfile()
      setSuccess('Configuration système mise à jour.')
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Impossible de mettre à jour la configuration système.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <PageFrame className="profile-settings-page">
      <div className="card profile-settings-card">
        <aside className="profile-settings-nav" aria-label="Paramètres du profil">
          <h2>Paramètres</h2>
          <ResponsiveTabs
            ariaLabel="Parametres du profil"
            className="profile-settings-tabs"
            options={[
              { label: 'Profil public', value: 'profile' },
              { label: 'Systeme', value: 'system' },
            ]}
            value={activeTab}
            onChange={changeTab}
          />
        </aside>

        <main className="profile-settings-main">
          {activeTab === 'profile' ? (
          <>
          <span className="eyebrow">Profil</span>
          <h1>Votre profil</h1>

          <div className={`profile-public-preview ${profileComplete ? 'is-complete' : 'needs-completion'}`}>
            <div className="profile-preview-avatar-shell">
              {previewAvatarUrl ? (
                <img src={previewAvatarUrl} alt="" />
              ) : (
                <span className="profile-public-avatar-initials" aria-hidden="true">
                  {profileInitials(draft)}
                </span>
              )}
            </div>
            <div>
              <span className="profile-preview-status">{profileComplete ? 'Profil prêt' : 'À compléter'}</span>
              <strong>{formatDisplayName(draft, 'Votre profil')}</strong>
              <span>{draft.username ? `@${draft.username}` : 'Nom d’utilisateur à définir'}</span>
            </div>
          </div>

          <form className="stacked-form profile-settings-form" onSubmit={handleProfileSubmit}>
            <div className="profile-photo-field">
              <span>Photo de profil</span>
              <div className="profile-photo-actions">
                <label className="secondary-button">
                  Choisir une photo
                  <input type="file" accept="image/*" onChange={handleAvatarChange} />
                </label>
                {previewAvatarUrl ? (
                  <button className="ghost-button" type="button" onClick={handleRemoveAvatar}>
                    Supprimer
                  </button>
                ) : null}
              </div>
            </div>

            <div className="form-grid two-fields">
              <label>
                Prénom
                <input
                  autoComplete="given-name"
                  value={draft.firstName}
                  onChange={(event) => updateDraft('firstName', event.target.value)}
                  placeholder="Votre prénom"
                />
              </label>

              <label>
                Nom
                <input
                  autoComplete="family-name"
                  value={draft.lastName}
                  onChange={(event) => updateDraft('lastName', event.target.value)}
                  placeholder="Votre nom"
                />
              </label>
            </div>

            <div className="form-grid two-fields">
              <label>
                Date de naissance
                <input
                  autoComplete="bday"
                  type="date"
                  min={minBirthDate}
                  max={maxBirthDate}
                  value={draft.birthDate}
                  onChange={(event) => updateDraft('birthDate', event.target.value)}
                />
              </label>

              <label>
                Nom d’utilisateur
                <input
                  autoComplete="username"
                  value={draft.username}
                  disabled={usernameLocked}
                  onChange={(event) => updateDraft('username', event.target.value)}
                  placeholder="Ex: mayele_player"
                />
              </label>
            </div>

            {usernameLocked ? <p className="muted">Nom d’utilisateur verrouillé: {profile?.username}</p> : null}

            {error ? <div className="form-error">{error}</div> : null}
            {success ? <div className="form-success">{success}</div> : null}

            {profileDirty ? (
              <div className="profile-save-bar">
                <span>Modifications non enregistrées</span>
                <button className="primary-button" type="submit" disabled={!canSubmitProfile}>
                  {saving ? 'Enregistrement...' : 'Enregistrer'}
                </button>
              </div>
            ) : null}
          </form>
          </>
          ) : (
          <>
          <span className="eyebrow">Système</span>
          <h1>Heure locale</h1>
          <p className="muted">Vos nouvelles quêtes commencent à minuit dans ce fuseau.</p>

          <form className="stacked-form profile-settings-form" onSubmit={handleSystemSubmit}>
            <label>
              Fuseau horaire
              <select value={draft.timeZone} onChange={(event) => updateDraft('timeZone', event.target.value)}>
                {timeZoneOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            {error ? <div className="form-error">{error}</div> : null}
            {success ? <div className="form-success">{success}</div> : null}

            {systemDirty ? (
              <div className="profile-save-bar">
                <span>Fuseau horaire modifié</span>
                <button className="primary-button" type="submit" disabled={!canSubmitSystem}>
                  {saving ? 'Enregistrement...' : 'Enregistrer'}
                </button>
              </div>
            ) : null}
          </form>
          </>
          )}
        </main>
      </div>
    </PageFrame>
  )
}
