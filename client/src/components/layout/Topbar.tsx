import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'

type TopbarProps = {
  authenticated: boolean
  drawerOpen: boolean
  notificationsSlot?: ReactNode
  onToggleDrawer: () => void
}

export function Topbar({ authenticated, drawerOpen, notificationsSlot, onToggleDrawer }: TopbarProps) {
  return (
    <header className="topbar app-topbar">
      <NavLink className="brand topbar-brand" to={authenticated ? '/dashboard' : '/'}>
        <span className="brand-mark" aria-hidden="true">
          <img src="/images/mayele-logo.svg" alt="" />
        </span>
        <span className="brand-copy">
          <strong>Mayele</strong>
        </span>
      </NavLink>

      {authenticated ? (
        <div className="topbar-actions app-topbar-actions">
          {notificationsSlot}
        </div>
      ) : null}

      {authenticated ? (
        <button
          className="mobile-menu-button app-drawer-button"
          type="button"
          aria-controls="mobile-menu-panel"
          aria-expanded={drawerOpen}
          aria-label={drawerOpen ? 'Fermer le menu' : 'Ouvrir le menu'}
          onClick={onToggleDrawer}
        >
          <span />
          <span />
          <span />
        </button>
      ) : null}
    </header>
  )
}
