import { useEffect, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { isNavigationItemActive, navigationItemsForAccess, type NavigationMatchContext } from './navigation'
import { LogoutNavIcon } from './navigationIcons'

type MobileDrawerProps = {
  displayName: string
  open: boolean
  presenceSlot?: ReactNode
  isAdmin?: boolean
  context: NavigationMatchContext
  expandedGroups: Set<string>
  onClose: () => void
  onLogout: () => void
  onToggleGroup: (label: string) => void
}

function groupId(label: string) {
  return label === 'Mon espace' ? 'dashboard' : label.toLowerCase()
}

export function MobileDrawer({
  displayName,
  open,
  presenceSlot,
  isAdmin = false,
  context,
  expandedGroups,
  onClose,
  onLogout,
  onToggleGroup,
}: MobileDrawerProps) {
  useEffect(() => {
    if (!open) {
      return
    }

    const previousBodyOverflow = document.body.style.overflow

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = previousBodyOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose, open])

  if (!open) {
    return null
  }

  return (
    <div className="mobile-menu-overlay app-drawer-overlay" role="presentation" onClick={onClose}>
      <nav
        id="mobile-menu-panel"
        className="mobile-menu-panel app-drawer-panel"
        aria-label="Navigation secondaire mobile"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mobile-menu-heading">
          <span>Menu</span>
          <strong>{displayName}</strong>
        </div>

        {presenceSlot}

        {navigationItemsForAccess(isAdmin).map((item) => {
          const active = isNavigationItemActive(item, context)
          const expanded = expandedGroups.has(item.label)

          return (
            <div className="mobile-drawer-section" key={item.label}>
              <Link className={active ? 'mobile-nav-link active' : 'mobile-nav-link'} to={item.to} onClick={onClose} aria-current={active ? 'page' : undefined}>
                <span>{item.label}</span>
                <span className="mobile-nav-symbol" aria-hidden="true">{item.icon}</span>
              </Link>

              {item.children ? (
                <>
                  <button
                    className="mobile-subnav-toggle"
                    type="button"
                    aria-controls={`mobile-subnav-${groupId(item.label)}`}
                    aria-expanded={expanded}
                    onClick={() => onToggleGroup(item.label)}
                  >
                    <span>{item.label === 'Jouer' ? 'Modes' : 'Sections'}</span>
                    <span className="nav-toggle-chevron" aria-hidden="true" />
                  </button>
                  <div
                    id={`mobile-subnav-${groupId(item.label)}`}
                    className={expanded ? 'mobile-subnav' : 'mobile-subnav collapsed'}
                    aria-label={`${item.label} - sous-navigation`}
                  >
                    {item.children.map((child) => {
                      const childActive = isNavigationItemActive(child, context)

                      return (
                        <Link className={childActive ? 'active' : ''} to={child.to} key={child.to} onClick={onClose} aria-current={childActive ? 'page' : undefined}>
                          {child.label}
                        </Link>
                      )
                    })}
                  </div>
                </>
              ) : null}
            </div>
          )
        })}

        <Link className="mobile-nav-link" to="/profil/configuration" onClick={onClose}>
          <span>Profil</span>
          <span className="mobile-nav-symbol" aria-hidden="true">P</span>
        </Link>

        <button className="mobile-nav-link danger" type="button" onClick={onLogout}>
          <span>Deconnexion</span>
          <span className="mobile-nav-symbol" aria-hidden="true"><LogoutNavIcon /></span>
        </button>
      </nav>
    </div>
  )
}
