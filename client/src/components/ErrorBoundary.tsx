import { Component, type ErrorInfo, type ReactNode } from 'react'
import { captureException } from '../lib/sentry'

type Props = {
  children: ReactNode
  fallback?: ReactNode
}

type State = {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: 'error',
        message: 'React render error',
        name: error.name,
        detail: error.message,
        componentStack: info.componentStack,
      }),
    )
    captureException(error, { componentStack: info.componentStack })
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <section className="page narrow-page">
            <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>
              <h2>Quelque chose s'est mal passé.</h2>
              <p style={{ marginTop: '0.75rem', color: 'var(--muted)' }}>
                {this.state.error?.message ?? 'Erreur inattendue.'}
              </p>
              <button
                className="ghost-button"
                style={{ marginTop: '1.5rem' }}
                type="button"
                onClick={() => {
                  this.setState({ hasError: false, error: null })
                  window.location.reload()
                }}
              >
                Recharger la page
              </button>
            </div>
          </section>
        )
      )
    }

    return this.props.children
  }
}
