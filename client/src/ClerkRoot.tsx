import { ClerkProvider } from '@clerk/react'
import { useNavigate } from 'react-router-dom'
import App from './App'

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

if (!clerkPublishableKey) {
  throw new Error('VITE_CLERK_PUBLISHABLE_KEY doit être défini.')
}

export function ClerkRoot() {
  const navigate = useNavigate()

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
      <App />
    </ClerkProvider>
  )
}
