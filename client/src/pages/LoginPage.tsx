import { useSignIn } from '@clerk/react/legacy'
import { type FormEvent, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/auth'
import { clerkErrorMessage } from '../lib/clerkErrors'

type LoginStep = 'credentials' | 'verify-client'

export function LoginPage() {
  const { isAuthenticated, loading } = useAuth()
  const { isLoaded, setActive, signIn } = useSignIn()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [step, setStep] = useState<LoginStep>('credentials')
  const [verificationCode, setVerificationCode] = useState('')
  const [submittedEmail, setSubmittedEmail] = useState('')
  const [secondFactorEmailAddressId, setSecondFactorEmailAddressId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const clerkBusy = !isLoaded
  const canSubmit = !clerkBusy && !submitting && email.trim().length > 3 && password.length > 0
  const canVerify = !clerkBusy && !submitting && verificationCode.trim().length >= 6

  if (!loading && isAuthenticated) {
    return <Navigate replace to="/dashboard" />
  }

  async function completeSession(sessionId: string | null) {
    if (!setActive || !sessionId) {
      setError('Session introuvable. Relancez la connexion.')
      return
    }

    await setActive({ session: sessionId })
    navigate('/dashboard', { replace: true })
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!isLoaded || !signIn || !setActive) {
      setError('Connexion indisponible pour le moment. Réessayez dans quelques secondes.')
      return
    }

    setSubmitting(true)
    setError('')

    try {
      const result = await signIn.create({
        identifier: email.trim(),
        strategy: 'password',
        password,
      })

      const completedSignIn =
        result.status === 'needs_first_factor'
          ? await signIn.attemptFirstFactor({ strategy: 'password', password })
          : result

      if (completedSignIn.status === 'complete') {
        await completeSession(completedSignIn.createdSessionId)
        return
      }

      if (completedSignIn.status === 'needs_client_trust' || completedSignIn.status === 'needs_second_factor') {
        const emailFactor = completedSignIn.supportedSecondFactors?.find((factor) => factor.strategy === 'email_code')

        if (emailFactor?.strategy === 'email_code') {
          await signIn.prepareSecondFactor({
            strategy: 'email_code',
            emailAddressId: emailFactor.emailAddressId,
          })
          setSecondFactorEmailAddressId(emailFactor.emailAddressId)
          setVerificationCode('')
          setSubmittedEmail(email.trim())
          setStep('verify-client')
          return
        }
      }

      setError('Connexion bloquée par une étape de sécurité non activée dans Mayele pour le moment.')
    } catch (caughtError) {
      setError(clerkErrorMessage(caughtError, 'Connexion impossible.'))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!isLoaded || !signIn) {
      setError('Validation indisponible pour le moment. Réessayez dans quelques secondes.')
      return
    }

    setSubmitting(true)
    setError('')

    try {
      const result = await signIn.attemptSecondFactor({
        strategy: 'email_code',
        code: verificationCode.trim(),
      })

      if (result.status === 'complete') {
        await completeSession(result.createdSessionId)
        return
      }

      setError('Code accepté, mais la connexion demande encore une étape.')
    } catch (caughtError) {
      setError(clerkErrorMessage(caughtError, 'Code invalide ou expiré.'))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleResendCode() {
    if (!isLoaded || !signIn || !secondFactorEmailAddressId) {
      setError('Impossible de renvoyer le code pour le moment.')
      return
    }

    setSubmitting(true)
    setError('')

    try {
      await signIn.prepareSecondFactor({
        strategy: 'email_code',
        emailAddressId: secondFactorEmailAddressId,
      })
    } catch (caughtError) {
      setError(clerkErrorMessage(caughtError, 'Impossible de renvoyer le code.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="page narrow-page">
      <div className="card form-card auth-card">
        {step === 'verify-client' ? (
          <>
            <span className="eyebrow">Sécurité</span>
            <h1>Vérifiez ce nouvel appareil</h1>
            <p className="muted">Nous avons envoyé un code à {submittedEmail}. Entrez-le pour ouvrir votre espace.</p>

            <form className="stacked-form" onSubmit={handleVerify}>
              <label>
                Code reçu par email
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
                {submitting ? 'Validation...' : 'Valider le code'}
              </button>
              <button className="ghost-button full-width" type="button" disabled={submitting} onClick={handleResendCode}>
                Renvoyer le code
              </button>
              <button
                className="ghost-button full-width"
                type="button"
                disabled={submitting}
                onClick={() => {
                  setStep('credentials')
                  setVerificationCode('')
                  setError('')
                }}
              >
                Revenir à la connexion
              </button>
            </form>
          </>
        ) : (
          <>
            <span className="eyebrow">Connexion</span>
            <h1>Retrouver mon espace</h1>
            <p className="muted">Connectez-vous avec votre email et votre mot de passe.</p>

            <form className="stacked-form" onSubmit={handleSubmit}>
              <label>
                Email
                <input
                  autoComplete="email"
                  type="email"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value)
                    setError('')
                  }}
                  placeholder="vous@exemple.com"
                />
              </label>

              <label>
                Mot de passe
                <input
                  autoComplete="current-password"
                  type="password"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value)
                    setError('')
                  }}
                  placeholder="Votre mot de passe"
                />
              </label>

              {error ? <div className="form-error">{error}</div> : null}

              <button className="primary-button full-width" type="submit" disabled={!canSubmit}>
                {submitting ? 'Connexion...' : 'Se connecter'}
              </button>
            </form>

            <p className="muted centered-text">
              Pas encore de compte ? <Link className="inline-link" to="/inscription">Créez votre espace</Link>
            </p>
          </>
        )}
      </div>
    </section>
  )
}
