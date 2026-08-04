import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { isNavigationItemActive, navigationItemsForAccess, type NavigationMatchContext } from './navigation'
import { LogoutNavIcon } from './navigationIcons'

type SidebarUser = {
  avatarUrl?: string | null
  name?: string | null
  username?: string | null
}

type DesktopSidebarProps = {
  collapsed: boolean
  displayName: string
  user: SidebarUser | null | undefined
  context: NavigationMatchContext
  expandedGroups: Set<string>
  presenceSlot?: ReactNode
  isAdmin?: boolean
  onToggleCollapsed: () => void
  onToggleGroup: (label: string) => void
  onLogout: () => void
}

function userInitials(user: SidebarUser | null | undefined) {
  const source = user?.name || user?.username || 'Mayele'
  return source
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'MJ'
}

function groupId(label: string) {
  return label === 'Mon espace' ? 'dashboard' : label.toLowerCase()
}

export function DesktopSidebar({
  collapsed,
  displayName,
  user,
  context,
  expandedGroups,
  presenceSlot,
  isAdmin = false,
  onToggleCollapsed,
  onToggleGroup,
  onLogout,
}: DesktopSidebarProps) {
  return (
    <aside className="desktop-sidebar" aria-label="Navigation principale">
      <div className="sidebar-topline">
        <button
          className="brand sidebar-brand sidebar-logo-toggle"
          type="button"
          aria-label={collapsed ? 'Etendre le menu lateral' : 'Reduire le menu lateral'}
          aria-pressed={collapsed}
          onClick={onToggleCollapsed}
        >
          <span className="brand-mark" aria-hidden="true">
            <img src="/images/mayele-logo.svg" alt="" />
          </span>
          <span className="brand-copy">
            <strong>Mayele</strong>
          </span>
        </button>
      </div>

      <nav className="sidebar-nav">
        <span className="sidebar-label">Navigation</span>
        {navigationItemsForAccess(isAdmin).map((item) => {
          const active = isNavigationItemActive(item, context)
          const expanded = expandedGroups.has(item.label)

          return (
            <div className="sidebar-nav-section" key={item.label}>
              <div className="sidebar-nav-group">
                <Link className={active ? 'nav-link active' : 'nav-link'} to={item.to} aria-current={active ? 'page' : undefined}>
                  <span className="sidebar-nav-symbol" aria-hidden="true">{item.icon}</span>
                  <span className="sidebar-nav-text">{item.label}</span>
                </Link>
                {item.children ? (
                  <button
                    className="sidebar-subnav-toggle"
                    type="button"
                    aria-controls={`desktop-subnav-${groupId(item.label)}`}
                    aria-expanded={expanded}
                    aria-label={expanded ? `Replier ${item.label}` : `Deplier ${item.label}`}
                    onClick={() => onToggleGroup(item.label)}
                  >
                    <span className="nav-toggle-chevron" aria-hidden="true" />
                  </button>
                ) : null}
              </div>

              {item.children ? (
                <div
                  id={`desktop-subnav-${groupId(item.label)}`}
                  className={expanded ? 'sidebar-subnav' : 'sidebar-subnav collapsed'}
                  aria-label={`${item.label} - sous-navigation`}
                >
                  {item.children.map((child) => {
                    const childActive = isNavigationItemActive(child, context)

                    return (
                      <Link className={childActive ? 'active' : ''} to={child.to} key={child.to} aria-current={childActive ? 'page' : undefined}>
                        {child.label}
                      </Link>
                    )
                  })}
                </div>
              ) : null}
            </div>
          )
        })}
      </nav>

      <div className="sidebar-account">
        {presenceSlot}
        <Link className="sidebar-profile" to="/profil/configuration" aria-label="Parametres du profil">
          {user?.avatarUrl ? (
            <img className="sidebar-profile-avatar" src={user.avatarUrl} alt="" />
          ) : (
            <span className="sidebar-profile-avatar initials" aria-hidden="true">
              {userInitials(user)}
            </span>
          )}
          <strong>{displayName}</strong>
          <span>Profil</span>
        </Link>
      </div>

      <button className="sidebar-logout" type="button" onClick={onLogout}>
        <span className="sidebar-logout-icon" aria-hidden="true"><LogoutNavIcon /></span>
        <span className="sidebar-logout-text">Deconnexion</span>
      </button>
    </aside>
  )
}
