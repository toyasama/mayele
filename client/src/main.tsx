import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Analytics } from '@vercel/analytics/react'
import { ClerkRoot } from './ClerkRoot.tsx'
import { initSentry } from './lib/sentry.ts'
import './index.css'

initSentry()
const shouldEnableAnalytics = import.meta.env.MODE === 'production'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ClerkRoot />
      {shouldEnableAnalytics ? <Analytics /> : null}
    </BrowserRouter>
  </StrictMode>,
)
