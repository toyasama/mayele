import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RegisterPage } from './RegisterPage'

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  setActive: vi.fn(),
  getToken: vi.fn(),
  updateProfile: vi.fn(),
  signUp: {
    create: vi.fn(),
    prepareEmailAddressVerification: vi.fn(),
    attemptEmailAddressVerification: vi.fn(),
  },
}))

vi.mock('@clerk/react', () => ({
  useClerk: () => ({ setActive: mocks.setActive, client: { signUp: mocks.signUp } }),
}))

vi.mock('../context/auth', () => ({
  useAuth: () => ({
    isAuthenticated: false,
    loading: false,
    getToken: mocks.getToken,
  }),
}))

vi.mock('../lib/api', () => ({ api: { updateProfile: mocks.updateProfile } }))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mocks.navigate }
})

function fillRegistrationForm() {
  fireEvent.change(screen.getByLabelText('Prénom'), { target: { value: 'Alice' } })
  fireEvent.change(screen.getByLabelText('Nom', { exact: true }), { target: { value: 'Martin' } })
  fireEvent.change(screen.getByLabelText('Date de naissance'), { target: { value: '2000-01-01' } })
  fireEvent.change(screen.getByLabelText('Nom d’utilisateur'), { target: { value: 'alice_martin' } })
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'alice@example.com' } })
  fireEvent.change(screen.getByLabelText('Mot de passe', { exact: true }), { target: { value: 'TestOnly-1234567' } })
  fireEvent.change(screen.getByLabelText('Confirmation'), { target: { value: 'TestOnly-1234567' } })
}

describe('RegisterPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getToken.mockResolvedValue('session-token')
    mocks.setActive.mockResolvedValue(undefined)
    mocks.updateProfile.mockResolvedValue({})
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
  })

  afterEach(cleanup)

  it('montre et centre le défi antirobot pendant que Clerk attend sa validation', async () => {
    mocks.signUp.create.mockImplementation(() => new Promise(() => {}))
    render(<MemoryRouter><RegisterPage /></MemoryRouter>)
    fillRegistrationForm()
    fireEvent.click(screen.getByRole('button', { name: 'Créer et vérifier mon compte' }))

    const captcha = document.getElementById('clerk-captcha')
    expect(captcha).not.toBeNull()
    expect(captcha?.getAttribute('data-cl-language')).toBe('fr-FR')
    expect(captcha?.getAttribute('data-cl-size')).toBe('flexible')
    // Clerk mounts the Cloudflare widget inside a div; the challenge internals
    // can live in a shadow tree, so there is no iframe to query from our page.
    captcha?.appendChild(document.createElement('div'))

    expect(await screen.findByRole('status')).toHaveTextContent('cochez la case de vérification antirobot')
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Vérification antirobot...' })).toBeDisabled()
  })

  it('passe au code puis active le compte et crée le profil', async () => {
    mocks.signUp.create.mockResolvedValue({ status: 'missing_requirements' })
    mocks.signUp.prepareEmailAddressVerification.mockResolvedValue(undefined)
    mocks.signUp.attemptEmailAddressVerification.mockResolvedValue({ status: 'complete', createdSessionId: 'sess_123' })
    render(<MemoryRouter><RegisterPage /></MemoryRouter>)
    fillRegistrationForm()
    fireEvent.click(screen.getByRole('button', { name: 'Créer et vérifier mon compte' }))

    await screen.findByRole('heading', { name: 'Entrez le code reçu' })
    expect(mocks.signUp.prepareEmailAddressVerification).toHaveBeenCalledWith({ strategy: 'email_code' })
    fireEvent.change(screen.getByLabelText('Code de vérification'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Activer mon espace' }))

    await waitFor(() => {
      expect(mocks.setActive).toHaveBeenCalledWith({ session: 'sess_123' })
      expect(mocks.updateProfile).toHaveBeenCalledWith(mocks.getToken, {
        firstName: 'Alice',
        lastName: 'Martin',
        birthDate: '2000-01-01',
        username: 'alice_martin',
        timeZone: expect.any(String),
      })
      expect(mocks.navigate).toHaveBeenCalledWith('/dashboard', { replace: true })
    })
  })
})
