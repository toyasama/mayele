import { ClerkProvider } from '@clerk/react'
import { useNavigate } from 'react-router-dom'
import App from './App'
import { isE2EAuthBypassEnabled } from './context/auth'
import { ProfileProvider } from './context/profile'
import { isClerkPublishableKey } from './lib/clerkConfig'

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

function BootstrapConfigurationError() {
  return (
    <main className="app-bootstrap-error" role="alert">
      <section className="card form-card auth-card auth-single-column">
        <span className="eyebrow">MAYELE</span>
        <h1>Application indisponible</h1>
        <p>Le service ne peut pas demarrer pour le moment. Reessayez dans quelques instants.</p>
        <button className="ghost-button" type="button" onClick={() => window.location.reload()}>
          Recharger
        </button>
      </section>
    </main>
  )
}

export function ClerkRoot() {
  const navigate = useNavigate()

  if (isE2EAuthBypassEnabled) {
    return (
      <ProfileProvider>
        <App />
      </ProfileProvider>
    )
  }

  if (!isClerkPublishableKey(clerkPublishableKey)) {
    return <BootstrapConfigurationError />
  }

  return (
    <ClerkProvider
      publishableKey={clerkPublishableKey}
      afterSignOutUrl="/"
      routerPush={(to) => navigate(to)}
      routerReplace={(to) => navigate(to, { replace: true })}
      signInUrl="/connexion"
      signUpUrl="/inscription"
      signInFallbackRedirectUrl="/dashboard"
      signUpFallbackRedirectUrl="/dashboard"
    >
      <ProfileProvider>
        <App />
      </ProfileProvider>
    </ClerkProvider>
  )
}
