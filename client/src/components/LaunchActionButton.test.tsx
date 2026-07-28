import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LaunchActionButton } from './LaunchActionButton'

afterEach(() => {
  cleanup()
  document.querySelectorAll('.launch-action-burst').forEach((burst) => burst.remove())
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('LaunchActionButton', () => {
  it('lance l’action immédiatement et protège contre les doubles clics', async () => {
    vi.useFakeTimers()
    const onLaunch = vi.fn()
    render(<LaunchActionButton label="Commencer le sprint" onLaunch={onLaunch} />)

    const button = screen.getByRole('button', { name: 'Commencer le sprint' })
    fireEvent.click(button)
    fireEvent.click(button)

    expect(onLaunch).toHaveBeenCalledTimes(1)
    expect(button).toHaveClass('is-launching')
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(520)
    })

    expect(button).not.toHaveClass('is-launching')
    expect(button).toBeEnabled()
  })

  it('reste un bouton natif utilisable au clavier', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    const onLaunch = vi.fn()
    render(<LaunchActionButton label="Commencer" onLaunch={onLaunch} />)

    const button = screen.getByRole('button', { name: 'Commencer' })
    button.focus()
    fireEvent.keyDown(button, { key: 'Enter' })
    fireEvent.click(button)

    expect(button).toHaveFocus()
    expect(onLaunch).toHaveBeenCalledTimes(1)
  })
})
