import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { criticalRemainingSeconds } from '../lib/challengeTiming'
import { ChallengeArenaScreen } from './ChallengeExperience'

function renderArena(remainingSeconds: number, criticalRemainingSeconds?: number, answerDisabled = false) {
  const { container } = render(
    <ChallengeArenaScreen
      answer=""
      answerDisabled={answerDisabled}
      contextLabel="Tempo - Debutant"
      elapsedLabel={`${10 - remainingSeconds}/10`}
      metrics={[]}
      modeLabel="Multi"
      onAnswerChange={vi.fn()}
      onSubmit={(event) => event.preventDefault()}
      progressPercent={0}
      question="1 + 1"
      remainingSeconds={remainingSeconds}
      criticalRemainingSeconds={criticalRemainingSeconds}
    />,
  )

  return container.querySelector('.challenge-arena')
}

describe('ChallengeArenaScreen', () => {
  afterEach(cleanup)

  it("n'affiche pas le timer en critique avant 30 pourcent du temps restant", () => {
    expect(renderArena(4, criticalRemainingSeconds(10))).not.toHaveClass('is-critical')
    expect(renderArena(19, criticalRemainingSeconds(60))).not.toHaveClass('is-critical')
  })

  it('affiche le timer en critique a partir de 30 pourcent du temps restant', () => {
    expect(renderArena(3, criticalRemainingSeconds(10))).toHaveClass('is-critical')
    expect(renderArena(18, criticalRemainingSeconds(60))).toHaveClass('is-critical')
  })

  it("rend explicite l'attente de validation d'une reponse tempo", () => {
    renderArena(8, criticalRemainingSeconds(10), true)

    expect(screen.getByRole('textbox', { name: /Votre reponse/i })).toBeVisible()
    expect(screen.getByRole('button', { name: /En attente/i })).toBeDisabled()
  })

  it('affiche le suivi de question quand il est fourni', () => {
    render(
      <ChallengeArenaScreen
        answer=""
        contextLabel="Tempo - Debutant"
        elapsedLabel="0/10"
        metrics={[]}
        modeLabel="Multi"
        onAnswerChange={vi.fn()}
        onSubmit={(event) => event.preventDefault()}
        progressPercent={0}
        question="1 + 1"
        questionProgressLabel="Question 3/30"
        remainingSeconds={10}
      />,
    )

    expect(screen.getByText('Question 3/30')).toBeVisible()
  })

  it('remonte uniquement des chiffres quand la reponse change', () => {
    const onAnswerChange = vi.fn()

    render(
      <ChallengeArenaScreen
        answer=""
        contextLabel="Tempo - Debutant"
        elapsedLabel="0/10"
        metrics={[]}
        modeLabel="Multi"
        onAnswerChange={onAnswerChange}
        onSubmit={(event) => event.preventDefault()}
        progressPercent={0}
        question="1 + 1"
        remainingSeconds={10}
      />,
    )

    fireEvent.change(screen.getByRole('textbox', { name: /Votre reponse/i }), {
      target: { value: '12bb3' },
    })

    expect(onAnswerChange).toHaveBeenCalledWith('123')
  })

  it('configure le clavier mobile pour valider avec Entrée', () => {
    const onSubmit = vi.fn((event) => event.preventDefault())

    render(
      <ChallengeArenaScreen
        answer="2"
        contextLabel="Tempo - Debutant"
        elapsedLabel="0/10"
        metrics={[]}
        modeLabel="Multi"
        onAnswerChange={vi.fn()}
        onSubmit={onSubmit}
        progressPercent={0}
        question="1 + 1"
        remainingSeconds={10}
      />,
    )

    const input = screen.getByRole('textbox', { name: /Votre reponse/i })

    expect(input).toHaveAttribute('inputmode', 'numeric')
    expect(input).toHaveAttribute('enterkeyhint', 'enter')
    expect(input).toHaveAttribute('aria-keyshortcuts', 'Enter')

    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })

    expect(onSubmit).toHaveBeenCalledTimes(1)
  })
})
