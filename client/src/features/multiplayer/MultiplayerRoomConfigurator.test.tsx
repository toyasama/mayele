import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_ROOM_CONFIG, type RoomConfig } from '../../lib/multiplayerConfig'
import { MultiplayerRoomConfigurator } from './MultiplayerRoomConfigurator'

afterEach(cleanup)

function Harness() {
  const [config, setConfig] = useState<RoomConfig>(DEFAULT_ROOM_CONFIG)

  return (
    <MultiplayerRoomConfigurator
      authoritativeConfig={config}
      controlsDisabled={false}
      editableConfig={config}
      onChange={(resolveNext) => setConfig((current) => resolveNext(current))}
    />
  )
}

describe('MultiplayerRoomConfigurator', () => {
  it('rend la progression de configuration lisible au fil des choix', () => {
    render(<Harness />)

    expect(screen.getByLabelText('0 choix sur 3')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /SprintContre la montre/i }))
    expect(screen.getByLabelText('1 choix sur 3')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: /Durée/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Addition/i }))
    fireEvent.click(screen.getByRole('button', { name: /Débutant/i }))
    expect(screen.getByRole('heading', { name: 'Prêt à envoyer' })).toBeInTheDocument()
    expect(screen.getByLabelText('3 choix sur 3')).toBeInTheDocument()
  })

  it('rend chaque choix idempotent pendant les resynchronisations serveur', () => {
    render(<Harness />)

    const sprint = screen.getByRole('button', { name: /SprintContre la montre/i })
    const addition = screen.getByRole('button', { name: /Addition/i })
    const beginner = screen.getByRole('button', { name: /butant/i })

    fireEvent.click(sprint)
    fireEvent.click(sprint)
    fireEvent.click(addition)
    fireEvent.click(addition)
    fireEvent.click(beginner)
    fireEvent.click(beginner)

    expect(screen.getByLabelText('3 choix sur 3')).toBeInTheDocument()
    expect(sprint).toHaveClass('active')
    expect(addition).toHaveClass('active')
    expect(beginner).toHaveClass('active')
  })
})
