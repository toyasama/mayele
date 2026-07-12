import { useClerk } from '@clerk/react'
import { type FormEvent, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/auth'
import { clerkErrorMessage } from '../lib/clerkErrors'

type LoginStep = 'credentials' | 'verify-client' | 'reset-request' | 'reset-code' | 'reset-password'

type PasswordResetFactorResult = {
  supportedFirstFactors?: Array<{ strategy: string; emailAddressId?: string }> | null
}

export function LoginPage() {
  const { isAuthenticated, loading } = useAuth()
  const clerk = useClerk()
  const signIn = clerk.client.signIn
  const setActive = clerk.setActive
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [step, setStep] = useState<LoginStep>('credentials')
  const [verificationCode, setVerificationCode] = useState('')
  const [submittedEmail, setSubmittedEmail] = useState('')
  const [secondFactorEmailAddressId, setSecondFactorEmailAddressId] = useState('')
  const [resetEmail, setResetEmail] = useState('')
  const [resetSubmittedEmail, setResetSubmittedEmail] = useState('')
  const [resetEmailAddressId, setResetEmailAddressId] = useState('')
  const [resetCode, setResetCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newPasswordConfirmation, setNewPasswordConfirmation] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const isLoaded = Boolean(signIn && setActive)
  const clerkBusy = !isLoaded
  const canSubmit = !clerkBusy && !submitting && email.trim().length > 3 && password.length > 0
  const canVerify = !clerkBusy && !submitting && verificationCode.trim().length >= 6
  const canRequestPasswordReset = !clerkBusy && !submitting && resetEmail.trim().length > 3
  const canVerifyResetCode = !clerkBusy && !submitting && resetCode.trim().length >= 6
  const resetPasswordsMismatch = newPasswordConfirmation.length > 0 && newPassword !== newPasswordConfirmation
  const resetPasswordChecks = [
    { label: '8 caractères minimum', valid: newPassword.length >= 8 },
    { label: 'Les deux mots de passe correspondent', valid: Boolean(newPassword) && newPassword === newPasswordConfirmation },
  ]
  const canResetPassword =
    !clerkBusy &&
    !submitting &&
    newPassword.length >= 8 &&
    newPassword === newPasswordConfirmation

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

  function storeResetFactor(result: PasswordResetFactorResult) {
    const resetFactor = result.supportedFirstFactors?.find((factor) => factor.strategy === 'reset_password_email_code')

    if (resetFactor?.emailAddressId) {
      setResetEmailAddressId(resetFactor.emailAddressId)
    }
  }

  function openResetFlow() {
    setResetEmail(email.trim())
    setResetSubmittedEmail('')
    setResetEmailAddressId('')
    setResetCode('')
    setNewPassword('')
    setNewPasswordConfirmation('')
    setError('')
    setStep('reset-request')
  }

  function backToCredentials() {
    setStep('credentials')
    setVerificationCode('')
    setResetCode('')
    setNewPassword('')
    setNewPasswordConfirmation('')
    setError('')
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

  async function handleRequestPasswordReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!isLoaded || !signIn) {
      setError('Réinitialisation indisponible pour le moment. Réessayez dans quelques secondes.')
      return
    }

    setSubmitting(true)
    setError('')

    try {
      const result = await signIn.create({
        strategy: 'reset_password_email_code',
        identifier: resetEmail.trim(),
      })

      storeResetFactor(result)
      setResetSubmittedEmail(resetEmail.trim())
      setResetCode('')
      setNewPassword('')
      setNewPasswordConfirmation('')
      setStep(result.status === 'needs_new_password' ? 'reset-password' : 'reset-code')
    } catch (caughtError) {
      setError(clerkErrorMessage(caughtError, 'Impossible d’envoyer le code de réinitialisation.'))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleVerifyResetCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!isLoaded || !signIn) {
      setError('Validation indisponible pour le moment. Réessayez dans quelques secondes.')
      return
    }

    setSubmitting(true)
    setError('')

    try {
      const result = await signIn.attemptFirstFactor({
        strategy: 'reset_password_email_code',
        code: resetCode.trim(),
      })

      if (result.status === 'needs_new_password') {
        setNewPassword('')
        setNewPasswordConfirmation('')
        setStep('reset-password')
        return
      }

      if (result.status === 'complete') {
        await completeSession(result.createdSessionId)
        return
      }

      setError('Code accepté, mais la réinitialisation demande encore une étape.')
    } catch (caughtError) {
      setError(clerkErrorMessage(caughtError, 'Code invalide ou expiré.'))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleResetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!isLoaded || !signIn || !setActive) {
      setError('Réinitialisation indisponible pour le moment. Réessayez dans quelques secondes.')
      return
    }

    if (newPassword !== newPasswordConfirmation) {
      setError('Les deux mots de passe ne correspondent pas.')
      return
    }

    setSubmitting(true)
    setError('')

    try {
      const result = await signIn.resetPassword({
        password: newPassword,
        signOutOfOtherSessions: true,
      })

      if (result.status === 'complete') {
        await completeSession(result.createdSessionId)
        return
      }

      setError('Le mot de passe est modifié, mais la connexion demande encore une étape.')
    } catch (caughtError) {
      setError(clerkErrorMessage(caughtError, 'Impossible de modifier le mot de passe.'))
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

  async function handleResendResetCode() {
    if (!isLoaded || !signIn || !resetSubmittedEmail) {
      setError('Impossible de renvoyer le code pour le moment.')
      return
    }

    setSubmitting(true)
    setError('')

    try {
      if (resetEmailAddressId) {
        await signIn.prepareFirstFactor({
          strategy: 'reset_password_email_code',
          emailAddressId: resetEmailAddressId,
          primary: true,
        })
      } else {
        const result = await signIn.create({
          strategy: 'reset_password_email_code',
          identifier: resetSubmittedEmail,
        })
        storeResetFactor(result)
      }
    } catch (caughtError) {
      setError(clerkErrorMessage(caughtError, 'Impossible de renvoyer le code.'))
    } finally {
      setSubmitting(false)
    }
  }

  if (step === 'reset-request') {
    return (
      <section className="page narrow-page">
        <div className="card form-card auth-card">
          <span className="eyebrow">Mot de passe oublié</span>
          <h1>Réinitialiser le mot de passe</h1>
          <p className="muted">Entrez l’email de votre compte Mayele. Nous vous enverrons un code de sécurité.</p>

          <form className="stacked-form" onSubmit={handleRequestPasswordReset}>
            <label>
              Email
              <input
                autoComplete="email"
                type="email"
                value={resetEmail}
                onChange={(event) => {
                  setResetEmail(event.target.value)
                  setError('')
                }}
                placeholder="vous@exemple.com"
              />
            </label>

            {error ? <div className="form-error">{error}</div> : null}

            <button className="primary-button full-width" type="submit" disabled={!canRequestPasswordReset}>
              {submitting ? 'Envoi...' : 'Envoyer le code'}
            </button>
            <button className="ghost-button full-width" type="button" disabled={submitting} onClick={backToCredentials}>
              Revenir à la connexion
            </button>
          </form>
        </div>
      </section>
    )
  }

  if (step === 'reset-code') {
    return (
      <section className="page narrow-page">
        <div className="card form-card auth-card">
          <span className="eyebrow">Vérification</span>
          <h1>Entrez le code reçu</h1>
          <p className="muted">Nous avons envoyé un code à {resetSubmittedEmail}. Il permet de choisir un nouveau mot de passe.</p>

          <form className="stacked-form" onSubmit={handleVerifyResetCode}>
            <label>
              Code reçu par email
              <input
                autoComplete="one-time-code"
                inputMode="numeric"
                maxLength={8}
                value={resetCode}
                onChange={(event) => {
                  setResetCode(event.target.value)
                  setError('')
                }}
                placeholder="123456"
              />
            </label>

            {error ? <div className="form-error">{error}</div> : null}

            <button className="primary-button full-width" type="submit" disabled={!canVerifyResetCode}>
              {submitting ? 'Validation...' : 'Valider le code'}
            </button>
            <button className="ghost-button full-width" type="button" disabled={submitting} onClick={handleResendResetCode}>
              Renvoyer le code
            </button>
            <button className="ghost-button full-width" type="button" disabled={submitting} onClick={openResetFlow}>
              Modifier l’email
            </button>
          </form>
        </div>
      </section>
    )
  }

  if (step === 'reset-password') {
    return (
      <section className="page narrow-page">
        <div className="card form-card auth-card">
          <span className="eyebrow">Nouveau mot de passe</span>
          <h1>Choisissez un nouveau mot de passe</h1>
          <p className="muted">Utilisez un mot de passe unique pour sécuriser votre espace Mayele.</p>

          <form className="stacked-form" onSubmit={handleResetPassword}>
            <label>
              Nouveau mot de passe
              <input
                autoComplete="new-password"
                type="password"
                value={newPassword}
                onChange={(event) => {
                  setNewPassword(event.target.value)
                  setError('')
                }}
                placeholder="8 caractères minimum"
              />
            </label>
            <label>
              Confirmation
              <input
                autoComplete="new-password"
                type="password"
                value={newPasswordConfirmation}
                onChange={(event) => {
                  setNewPasswordConfirmation(event.target.value)
                  setError('')
                }}
                placeholder="Répétez le mot de passe"
                aria-invalid={resetPasswordsMismatch}
              />
            </label>

            <div className="password-checklist">
              {resetPasswordChecks.map((item) => (
                <span className={item.valid ? 'valid' : ''} key={item.label}>
                  {item.label}
                </span>
              ))}
            </div>

            {error ? <div className="form-error">{error}</div> : null}

            <button className="primary-button full-width" type="submit" disabled={!canResetPassword}>
              {submitting ? 'Modification...' : 'Changer le mot de passe'}
            </button>
          </form>
        </div>
      </section>
    )
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
              <button className="ghost-button full-width" type="button" disabled={submitting} onClick={backToCredentials}>
                Revenir à la connexion
              </button>
            </form>
          </>
        ) : (
          <>
            <span className="eyebrow">Connexion</span>
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
                  placeholder="toto@exemple.com"
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
                  placeholder="Mot de passe"
                />
              </label>
              <div className="auth-form-link-row">
                <button className="inline-link auth-link-button" type="button" onClick={openResetFlow}>
                  Mot de passe oublié ?
                </button>
              </div>

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
