import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LoginPage } from './LoginPage'

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  setActive: vi.fn(),
  signIn: {
    create: vi.fn(),
    attemptFirstFactor: vi.fn(),
    resetPassword: vi.fn(),
    prepareFirstFactor: vi.fn(),
    prepareSecondFactor: vi.fn(),
    attemptSecondFactor: vi.fn(),
  },
}))

vi.mock('@clerk/react', () => ({
  useClerk: () => ({
    setActive: mocks.setActive,
    client: {
      signIn: mocks.signIn,
    },
  }),
}))

vi.mock('../context/auth', () => ({
  useAuth: () => ({
    isAuthenticated: false,
    loading: false,
  }),
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')

  return {
    ...actual,
    useNavigate: () => mocks.navigate,
  }
})

function renderLoginPage() {
  render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  )
}

async function requestResetCode() {
  mocks.signIn.create.mockResolvedValueOnce({
    status: 'needs_first_factor',
    supportedFirstFactors: [
      {
        strategy: 'reset_password_email_code',
        emailAddressId: 'email_123',
      },
    ],
  })

  renderLoginPage()

  fireEvent.click(screen.getByRole('button', { name: /mot de passe oublié/i }))
  fireEvent.change(screen.getByRole('textbox', { name: /email/i }), {
    target: { value: 'parent@example.com' },
  })
  fireEvent.click(screen.getByRole('button', { name: /envoyer le code/i }))

  await screen.findByRole('heading', { name: /entrez le code reçu/i })
}

describe('LoginPage password reset', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(cleanup)

  it('demande un code de réinitialisation via Clerk', async () => {
    await requestResetCode()

    expect(mocks.signIn.create).toHaveBeenCalledWith({
      strategy: 'reset_password_email_code',
      identifier: 'parent@example.com',
    })
    expect(screen.getByText(/parent@example.com/i)).toBeVisible()
  })

  it('valide le code, change le mot de passe et active la session', async () => {
    mocks.signIn.attemptFirstFactor.mockResolvedValueOnce({
      status: 'needs_new_password',
    })
    mocks.signIn.resetPassword.mockResolvedValueOnce({
      status: 'complete',
      createdSessionId: 'sess_123',
    })

    await requestResetCode()

    fireEvent.change(screen.getByLabelText(/code reçu par email/i), {
      target: { value: '123456' },
    })
    fireEvent.click(screen.getByRole('button', { name: /valider le code/i }))

    await screen.findByRole('heading', { name: /choisissez un nouveau mot de passe/i })

    fireEvent.change(screen.getByLabelText(/nouveau mot de passe/i), {
      target: { value: 'NouveauMotDePasse123' },
    })
    fireEvent.change(screen.getByLabelText(/confirmation/i), {
      target: { value: 'NouveauMotDePasse123' },
    })
    fireEvent.click(screen.getByRole('button', { name: /changer le mot de passe/i }))

    await waitFor(() => {
      expect(mocks.signIn.attemptFirstFactor).toHaveBeenCalledWith({
        strategy: 'reset_password_email_code',
        code: '123456',
      })
      expect(mocks.signIn.resetPassword).toHaveBeenCalledWith({
        password: 'NouveauMotDePasse123',
        signOutOfOtherSessions: true,
      })
      expect(mocks.setActive).toHaveBeenCalledWith({ session: 'sess_123' })
      expect(mocks.navigate).toHaveBeenCalledWith('/dashboard', { replace: true })
    })
  })

  it('renvoie le code avec le facteur de réinitialisation Clerk', async () => {
    await requestResetCode()

    fireEvent.click(screen.getByRole('button', { name: /renvoyer le code/i }))

    await waitFor(() => {
      expect(mocks.signIn.prepareFirstFactor).toHaveBeenCalledWith({
        strategy: 'reset_password_email_code',
        emailAddressId: 'email_123',
        primary: true,
      })
    })
  })

  it('bloque la modification tant que les mots de passe ne correspondent pas', async () => {
    mocks.signIn.attemptFirstFactor.mockResolvedValueOnce({
      status: 'needs_new_password',
    })

    await requestResetCode()

    fireEvent.change(screen.getByLabelText(/code reçu par email/i), {
      target: { value: '123456' },
    })
    fireEvent.click(screen.getByRole('button', { name: /valider le code/i }))

    await screen.findByRole('heading', { name: /choisissez un nouveau mot de passe/i })

    fireEvent.change(screen.getByLabelText(/nouveau mot de passe/i), {
      target: { value: 'NouveauMotDePasse123' },
    })
    fireEvent.change(screen.getByLabelText(/confirmation/i), {
      target: { value: 'different123' },
    })

    expect(screen.getByRole('button', { name: /changer le mot de passe/i })).toBeDisabled()
    expect(mocks.signIn.resetPassword).not.toHaveBeenCalled()
  })
})
