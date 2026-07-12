import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from './ErrorBoundary'

function BrokenComponent() {
  throw new Error('Boom')
  return null
}

describe('ErrorBoundary', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('affiche un fallback quand un composant enfant plante', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      <ErrorBoundary>
        <BrokenComponent />
      </ErrorBoundary>,
    )

    expect(screen.getByRole('heading', { name: /quelque chose/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /recharger/i })).toBeInTheDocument()
  })
})
