import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SoloResultStage } from './SoloResultStage'

afterEach(cleanup)

describe('SoloResultStage', () => {
  it('affiche un état neutre lorsqu’aucune réponse n’a été enregistrée', () => {
    render(
      <SoloResultStage
        accuracy={0}
        answers={[]}
        modeLabel="Sprint"
        sessionLabel="Sprint · Mixte · Débutant"
        skillLabel={(skill) => skill}
        stats={{ correctAnswers: 0, totalQuestions: 0, scorePoints: 0, xp: 0, currentStreak: 0, bestStreak: 0 }}
        onReplay={vi.fn()}
        onReturn={vi.fn()}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Partie terminée.' })).toBeInTheDocument()
    expect(screen.getByText('Aucune réponse enregistrée')).toBeInTheDocument()
    expect(screen.queryByText('Sans faute')).not.toBeInTheDocument()
    expect(screen.queryByText('Toutes les réponses sont justes')).not.toBeInTheDocument()
  })

  it('met en avant la compétence la plus souvent manquée', () => {
    const onReplay = vi.fn()
    const onReturn = vi.fn()

    render(
      <SoloResultStage
        accuracy={50}
        answers={[
          { prompt: '1 + 1', correctAnswer: 2, userAnswer: 3, responseTimeMs: 900, isCorrect: false, game: 'addition', level: 'debutant', skill: 'addition' },
          { prompt: '2 + 2', correctAnswer: 4, userAnswer: 5, responseTimeMs: 1_100, isCorrect: false, game: 'addition', level: 'debutant', skill: 'addition' },
          { prompt: '3 - 1', correctAnswer: 2, userAnswer: 2, responseTimeMs: 700, isCorrect: true, game: 'soustraction', level: 'debutant', skill: 'soustraction' },
          { prompt: '4 - 1', correctAnswer: 3, userAnswer: 3, responseTimeMs: 900, isCorrect: true, game: 'soustraction', level: 'debutant', skill: 'soustraction' },
        ]}
        modeLabel="Sprint"
        sessionLabel="Sprint · Mixte · Débutant"
        skillLabel={(skill) => (skill === 'addition' ? 'Additions' : skill)}
        stats={{ correctAnswers: 2, totalQuestions: 4, scorePoints: 180, xp: 12, currentStreak: 2, bestStreak: 2 }}
        onReplay={onReplay}
        onReturn={onReturn}
      />,
    )

    expect(screen.getByText('Tu progresses.')).toBeInTheDocument()
    expect(screen.getByText('Additions')).toBeInTheDocument()
    expect(screen.getByText('900 ms')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Rejouer' }))
    fireEvent.click(screen.getByRole('button', { name: 'Changer de partie' }))
    expect(onReplay).toHaveBeenCalledOnce()
    expect(onReturn).toHaveBeenCalledOnce()
  })
})
