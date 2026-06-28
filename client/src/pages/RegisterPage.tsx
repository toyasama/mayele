import { useSignUp } from '@clerk/react'
import { type FormEvent, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/auth'
import { clerkErrorMessage } from '../lib/clerkErrors'

type RegisterStep = 'details' | 'verify'

type RegisterForm = {
  firstName: string
  lastName: string
  email: string
  password: string
  confirmPassword: string
}

const initialForm: RegisterForm = {
  firstName: '',
  lastName: '',
  email: '',
  password: '',
  confirmPassword: '',
}

export function RegisterPage() {
  const { isAuthenticated, loading } = useAuth()
  const { fetchStatus, signUp } = useSignUp()
  const navigate = useNavigate()
  const [form, setForm] = useState(initialForm)
  const [step, setStep] = useState<RegisterStep>('details')
  const [verificationCode, setVerificationCode] = useState('')
  const [submittedEmail, setSubmittedEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const passwordChecks = [
    { label: '8 caractères minimum', valid: form.password.length >= 8 },
    { label: 'Les deux mots de passe correspondent', valid: Boolean(form.password) && form.password === form.confirmPassword },
  ]
  const clerkBusy = fetchStatus === 'fetching'
  const passwordsMismatch = form.confirmPassword.length > 0 && form.password !== form.confirmPassword
  const canCreateAccount =
    !clerkBusy &&
    !submitting &&
    form.firstName.trim().length >= 2 &&
    form.email.trim().length > 3 &&
    form.password.length >= 8 &&
    form.password === form.confirmPassword
  const canVerify = !clerkBusy && !submitting && verificationCode.trim().length >= 6

  if (!loading && isAuthenticated) {
    return <Navigate replace to="/dashboard" />
  }

  function updateForm(field: keyof RegisterForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }))
    setError('')
  }

  async function finalizeSignUp() {
    const { error: finalizeError } = await signUp.finalize({
      navigate: ({ decorateUrl }) => {
        const destination = decorateUrl('/dashboard')

        if (destination.startsWith('http')) {
          window.location.href = destination
          return
        }

        navigate(destination)
      },
    })

    if (finalizeError) {
      setError(clerkErrorMessage(finalizeError, 'Impossible de terminer l’inscription.'))
    }
  }

  async function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (form.password !== form.confirmPassword) {
      setError('Les deux mots de passe ne correspondent pas.')
      return
    }

    setSubmitting(true)
    setError('')

    try {
      const { error: passwordError } = await signUp.password({
        emailAddress: form.email.trim(),
        password: form.password,
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim() || undefined,
      })

      if (passwordError) {
        setError(clerkErrorMessage(passwordError, 'Impossible de terminer l’inscription.'))
        return
      }

      if (signUp.status === 'complete') {
        await finalizeSignUp()
        return
      }

      const { error: verificationError } = await signUp.verifications.sendEmailCode()

      if (verificationError) {
        setError(clerkErrorMessage(verificationError, 'Impossible de terminer l’inscription.'))
        return
      }

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

    setSubmitting(true)
    setError('')

    try {
      const { error: verificationError } = await signUp.verifications.verifyEmailCode({
        code: verificationCode.trim(),
      })

      if (verificationError) {
        setError(clerkErrorMessage(verificationError, 'Impossible de terminer l’inscription.'))
        return
      }

      if (signUp.status === 'complete') {
        await finalizeSignUp()
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
              <h1>Créer mon espace</h1>
              <p className="muted">Commencez avec un profil lisible, puis Mayele suivra vos sprints et vos progrès.</p>
              <form className="stacked-form" onSubmit={handleRegister}>
                <div className="form-grid two-fields">
                  <label>
                    Prénom
                    <input
                      autoComplete="given-name"
                      value={form.firstName}
                      onChange={(event) => updateForm('firstName', event.target.value)}
                      placeholder="Emery"
                    />
                  </label>
                  <label>
                    Nom
                    <input
                      autoComplete="family-name"
                      value={form.lastName}
                      onChange={(event) => updateForm('lastName', event.target.value)}
                      placeholder="Optionnel"
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
                    placeholder="vous@exemple.com"
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
