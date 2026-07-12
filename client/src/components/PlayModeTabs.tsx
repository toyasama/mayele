import { useLocation, useNavigate } from 'react-router-dom'
import { ResponsiveTabs } from './layout/ResponsiveTabs'

export type PlayModePath = '/jeu/solo' | '/jeu/multijoueur'

type PlayModeTabsProps = {
  onSelectMode?: (path: PlayModePath) => boolean | void
}

const modes: Array<{ label: string; path: PlayModePath }> = [
  { label: 'Solo', path: '/jeu/solo' },
  { label: 'Multijoueur', path: '/jeu/multijoueur' },
]

export function PlayModeTabs({ onSelectMode }: PlayModeTabsProps) {
  const location = useLocation()
  const navigate = useNavigate()

  function selectMode(path: PlayModePath) {
    if (onSelectMode?.(path) === false) {
      return
    }

    navigate(path)
  }

  return (
    <ResponsiveTabs
      ariaLabel="Modes de jeu"
      className="play-mode-tabs"
      options={modes.map((mode) => ({ label: mode.label, value: mode.path }))}
      value={location.pathname === '/jeu/multijoueur' ? '/jeu/multijoueur' : '/jeu/solo'}
      onChange={selectMode}
    />
  )
}
