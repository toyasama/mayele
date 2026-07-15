import { ClerkProvider } from '@clerk/react'
import { useNavigate } from 'react-router-dom'
import App from './App'
import { isE2EAuthBypassEnabled } from './context/auth'
import { ProfileProvider } from './context/profile'

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

if (!clerkPublishableKey && !isE2EAuthBypassEnabled) {
  throw new Error('VITE_CLERK_PUBLISHABLE_KEY doit être défini.')
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
