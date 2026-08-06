import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DashboardData } from '../../lib/api'
import { TrophyShelf } from './TrophyShelf'

type Badge = DashboardData['badges'][number]

function makeBadge(overrides: Partial<Badge> = {}): Badge {
  return {
    key: 'discovery_debutant',
    title: 'Jeune Débutant',
    description: 'Découvrir les modes.',
    family: 'mastery',
    familyLabel: 'Parcours',
    familyDescription: 'Progresser par niveau.',
    tier: 'discovery',
    level: 'debutant',
    completed: false,
    progress: 40,
    completedObjectives: 2,
    totalObjectives: 5,
    objectives: [],
    ...overrides,
  }
}

describe('TrophyShelf', () => {
  afterEach(cleanup)

  it('place les familles dans une sous-section Sprint explicite', () => {
    render(<TrophyShelf badges={[makeBadge()]} onSelect={vi.fn()} />)

    const sprintSection = screen.getByRole('region', { name: 'Sprint' })

    expect(within(sprintSection).getByText('Mode de jeu')).toBeVisible()
    expect(within(sprintSection).getByText('Badges obtenus lors des Sprints solo terminés.')).toBeVisible()
    expect(within(sprintSection).getByRole('tablist', { name: 'Familles de badges Sprint' })).toBeVisible()
    expect(within(sprintSection).getByRole('tab', { name: /Tous0\/1/i })).toBeVisible()
    expect(within(sprintSection).getByRole('tab', { name: /Parcours0\/1/i })).toBeVisible()
  })

  it('affiche une illustration et une progression propres à chaque badge', () => {
    const { container } = render(
      <TrophyShelf
        badges={[
          makeBadge(),
          makeBadge({ key: 'confirmed_debutant', title: 'Confirmé Débutant', tier: 'confirmed', progress: 60, completedObjectives: 3 }),
        ]}
        onSelect={vi.fn()}
      />,
    )

    expect(container.querySelectorAll('.badge-art')).toHaveLength(2)
    expect(container.querySelectorAll('.trophy-medal')).toHaveLength(0)
    expect(screen.getByRole('progressbar', { name: /Jeune Débutant/i })).toHaveValue(40)
    expect(screen.getByRole('progressbar', { name: /Confirmé Débutant/i })).toHaveValue(60)
    expect(screen.getByText('2/5 objectifs')).toBeVisible()
    expect(screen.getByText('3/5 objectifs')).toBeVisible()
  })

  it('indique le bilan de chaque famille et transmet le badge sélectionné', () => {
    const onSelect = vi.fn()
    const speedBadge = makeBadge({
      key: 'sprinter_apprentice_debutant',
      title: 'Apprenti sprinteur Débutant',
      family: 'speed',
      familyLabel: 'Vitesse',
      tier: 'sprinter_apprentice',
      completed: true,
      progress: 100,
      completedObjectives: 5,
    })

    render(<TrophyShelf badges={[makeBadge(), speedBadge]} onSelect={onSelect} />)

    const speedTab = screen.getByRole('tab', { name: /Vitesse1\/1/i })
    fireEvent.click(speedTab)
    fireEvent.click(screen.getByRole('button', { name: /Apprenti sprinteur Débutant, 100%/i }))

    expect(speedTab).toHaveAttribute('aria-selected', 'true')
    expect(onSelect).toHaveBeenCalledWith(speedBadge)
    expect(screen.getByText('Terminé')).toBeVisible()
  })

  it('réaffiche toutes les familles lorsque le filtre Tous est sélectionné', () => {
    const speedBadge = makeBadge({
      key: 'sprinter_apprentice_debutant',
      title: 'Apprenti sprinteur Débutant',
      family: 'speed',
      familyLabel: 'Vitesse',
      tier: 'sprinter_apprentice',
    })

    render(<TrophyShelf badges={[makeBadge(), speedBadge]} onSelect={vi.fn()} />)

    fireEvent.click(screen.getByRole('tab', { name: /Vitesse0\/1/i }))
    expect(screen.queryByRole('button', { name: /Jeune Débutant/i })).not.toBeInTheDocument()

    const allTab = screen.getByRole('tab', { name: /Tous0\/2/i })
    fireEvent.click(allTab)

    expect(allTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('button', { name: /Jeune Débutant/i })).toBeVisible()
    expect(screen.getByRole('button', { name: /Apprenti sprinteur Débutant/i })).toBeVisible()
  })
})
