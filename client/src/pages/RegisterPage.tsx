import { useClerk } from '@clerk/react'
import { type FormEvent, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/auth'
import { api } from '../lib/api'
import { clerkErrorMessage } from '../lib/clerkErrors'
import { dateInputLimit, isValidBirthDate, USERNAME_PATTERN } from '../lib/profile'
import { DEFAULT_TIME_ZONE, detectBrowserTimeZone, isValidTimeZone } from '../lib/timeZone'
import '../styles/routes/auth.css'

type RegisterStep = 'details' | 'verify'

type RegisterForm = {
  firstName: string
  lastName: string
  birthDate: string
  username: string
  email: string
  password: string
  confirmPassword: string
}

type TokenProvider = () => Promise<string | null>

const initialForm: RegisterForm = {
  firstName: '',
  lastName: '',
  birthDate: '',
  username: '',
  email: '',
  password: '',
  confirmPassword: '',
}

async function waitForActiveSessionToken(getToken: TokenProvider) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const token = await getToken()

    if (token) {
      return
    }

    await new Promise((resolve) => window.setTimeout(resolve, 120))
  }

  throw new Error('Session Mayele indisponible.')
}

function detectedSignupTimeZone() {
  const timeZone = detectBrowserTimeZone()
  return isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE
}

export function RegisterPage() {
  const { isAuthenticated, loading, getToken } = useAuth()
  const clerk = useClerk()
  const signUp = clerk.client?.signUp
  const setActive = clerk.setActive
  const navigate = useNavigate()
  const [form, setForm] = useState(initialForm)
  const [step, setStep] = useState<RegisterStep>('details')
  const [verificationCode, setVerificationCode] = useState('')
  const [submittedEmail, setSubmittedEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const isLoaded = Boolean(signUp && setActive)
  const clerkBusy = !isLoaded
  const passwordsMismatch = form.confirmPassword.length > 0 && form.password !== form.confirmPassword
  const passwordChecks = [
    { label: '8 caractères minimum', valid: form.password.length >= 8 },
    { label: 'Les deux mots de passe correspondent', valid: Boolean(form.password) && form.password === form.confirmPassword },
  ]
  const canCreateAccount =
    !clerkBusy &&
    !submitting &&
    form.firstName.trim().length >= 2 &&
    form.lastName.trim().length >= 2 &&
    USERNAME_PATTERN.test(form.username.trim()) &&
    isValidBirthDate(form.birthDate) &&
    form.email.trim().length > 3 &&
    form.password.length >= 8 &&
    form.password === form.confirmPassword
  const canVerify = !clerkBusy && !submitting && verificationCode.trim().length >= 6

  if (!loading && isAuthenticated && !submitting) {
    return <Navigate replace to="/dashboard" />
  }

  function updateForm(field: keyof RegisterForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }))
    setError('')
  }

  function profileDraft() {
    return {
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      birthDate: form.birthDate,
      username: form.username.trim().toLowerCase(),
      timeZone: detectedSignupTimeZone(),
    }
  }

  async function activateAccountAndCreateProfile(sessionId: string | null) {
    if (!setActive) {
      throw new Error('Inscription indisponible pour le moment.')
    }

    await setActive({ session: sessionId })
    await waitForActiveSessionToken(getToken)

    try {
      await api.updateProfile(getToken, profileDraft())
      navigate('/dashboard', { replace: true })
    } catch {
      navigate('/profil/configuration', {
        replace: true,
        state: { profileDraft: profileDraft() },
      })
    }
  }

  async function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!isLoaded || !signUp || !setActive) {
      setError('Inscription indisponible pour le moment. Réessayez dans quelques secondes.')
      return
    }

    if (form.password !== form.confirmPassword) {
      setError('Les deux mots de passe ne correspondent pas.')
      return
    }

    setSubmitting(true)
    setError('')

    try {
      const result = await signUp.create({
        emailAddress: form.email.trim(),
        password: form.password,
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim() || undefined,
      })

      if (result.status === 'complete') {
        await activateAccountAndCreateProfile(result.createdSessionId)
        return
      }

      await signUp.prepareEmailAddressVerification({ strategy: 'email_code' })
      setSubmittedEmail(form.email.trim())
      setStep('verify')
    } catch (caughtError) {
      setError(clerkErrorMessage(caughtError, 'Impossible de terminer l’inscription.'))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!isLoaded || !signUp || !setActive) {
      setError('Validation indisponible pour le moment. Réessayez dans quelques secondes.')
      return
    }

    setSubmitting(true)
    setError('')

    try {
      const result = await signUp.attemptEmailAddressVerification({
        code: verificationCode.trim(),
      })

      if (result.status === 'complete') {
        await activateAccountAndCreateProfile(result.createdSessionId)
        return
      }

      setError('Le code est accepté, mais Clerk demande encore une étape. Réessayez dans un instant.')
    } catch (caughtError) {
      setError(clerkErrorMessage(caughtError, 'Impossible de terminer l’inscription.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="page auth-page">
      <div className="auth-single-column">
        <div className="card form-card auth-card">
          <div className="auth-step-progress" aria-label="Étapes de l'inscription">
            <span className={step === 'details' ? 'active' : 'complete'}><strong>1</strong> Vos informations</span>
            <span className={step === 'verify' ? 'active' : ''}><strong>2</strong> Vérification</span>
          </div>
          {step === 'verify' ? (
            <>
              <span className="eyebrow">Validation</span>
              <h1>Entrez le code reçu</h1>
              <p className="muted">Nous avons envoyé un code à {submittedEmail}. Il active votre espace Mayele.</p>
              <form className="stacked-form" onSubmit={handleVerify}>
                <label>
                  Code de vérification
                  <input
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    maxLength={8}
                    value={verificationCode}
                    onChange={(event) => {
                      setVerificationCode(event.target.value)
                      setError('')
                    }}
                    placeholder="123456"
                  />
                </label>

                {error ? <div className="form-error">{error}</div> : null}

                <button className="primary-button full-width" type="submit" disabled={!canVerify}>
                  {submitting ? 'Vérification...' : 'Activer mon espace'}
                </button>
                <button className="ghost-button full-width" type="button" onClick={() => setStep('details')}>
                  Modifier mes informations
                </button>
              </form>
            </>
          ) : (
            <>
              <span className="eyebrow">Inscription</span>
              <h1>Créer votre compte</h1>
              <form className="stacked-form" onSubmit={handleRegister}>
                <div className="form-grid two-fields">
                  <label>
                    Prénom
                    <input
                      autoComplete="given-name"
                      value={form.firstName}
                      onChange={(event) => updateForm('firstName', event.target.value)}
                      placeholder="bob"
                    />
                  </label>
                  <label>
                    Nom
                    <input
                      autoComplete="family-name"
                      value={form.lastName}
                      onChange={(event) => updateForm('lastName', event.target.value)}
                      placeholder="smith"
                    />
                  </label>
                </div>

                <div className="form-grid two-fields">
                  <label>
                    Date de naissance
                    <input
                      autoComplete="bday"
                      type="date"
                      min={dateInputLimit('min')}
                      max={dateInputLimit('max')}
                      value={form.birthDate}
                      onChange={(event) => updateForm('birthDate', event.target.value)}
                    />
                  </label>
                  <label>
                    Nom d’utilisateur
                    <input
                      autoComplete="username"
                      value={form.username}
                      onChange={(event) => updateForm('username', event.target.value)}
                      placeholder="bobsmith"
                    />
                  </label>
                </div>

                <label>
                  Email
                  <input
                    autoComplete="email"
                    type="email"
                    value={form.email}
                    onChange={(event) => updateForm('email', event.target.value)}
                    placeholder="bobsmith@exemple.com"
                  />
                </label>

                <div className="form-grid two-fields">
                  <label>
                    Mot de passe
                    <input
                      autoComplete="new-password"
                      type="password"
                      value={form.password}
                      onChange={(event) => updateForm('password', event.target.value)}
                      placeholder="8 caractères minimum"
                    />
                  </label>
                  <label>
                    Confirmation
                    <input
                      autoComplete="new-password"
                      type="password"
                      value={form.confirmPassword}
                      onChange={(event) => updateForm('confirmPassword', event.target.value)}
                      placeholder="Répétez le mot de passe"
                      aria-invalid={passwordsMismatch}
                    />
                  </label>
                </div>

                <div className="password-checklist">
                  {passwordChecks.map((item) => (
                    <span className={item.valid ? 'valid' : ''} key={item.label}>
                      {item.label}
                    </span>
                  ))}
                </div>

                <div id="clerk-captcha" />

                {error ? <div className="form-error">{error}</div> : null}

                <button className="primary-button full-width" type="submit" disabled={!canCreateAccount}>
                  {submitting ? 'Création...' : 'Créer et vérifier mon compte'}
                </button>
              </form>

              <p className="muted centered-text">
                Vous avez déjà un compte ? <Link className="inline-link" to="/connexion">Connectez-vous</Link>
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
