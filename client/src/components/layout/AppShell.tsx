import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { DesktopSidebar } from './DesktopSidebar'
import { MobileBottomNav } from './MobileBottomNav'
import { MobileDrawer } from './MobileDrawer'
import { Topbar } from './Topbar'
import type { NavigationMatchContext } from './navigation'

type ShellUser = {
  avatarUrl?: string | null
  name?: string | null
  username?: string | null
}

type AppShellProps = {
  authenticated: boolean
  children: ReactNode
  displayName: string
  displayUser: ShellUser | null | undefined
  notificationsSlot?: ReactNode
  presenceSlot?: (className?: string) => ReactNode
  isAdmin?: boolean
  onLogout: () => void
}

function initialExpandedGroups(pathname: string) {
  const groups = new Set<string>()

  if (pathname.startsWith('/jeu')) {
    groups.add('Jouer')
  }

  return groups
}

export function AppShell({
  authenticated,
  children,
  displayName,
  displayUser,
  notificationsSlot,
  presenceSlot,
  isAdmin = false,
  onLogout,
}: AppShellProps) {
  const location = useLocation()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => initialExpandedGroups(location.pathname))
  const context: NavigationMatchContext = useMemo(
    () => ({ pathname: location.pathname, search: location.search }),
    [location.pathname, location.search],
  )

  useEffect(() => {
    setDrawerOpen(false)
    setExpandedGroups((current) => {
      const next = new Set(current)

      if (location.pathname.startsWith('/jeu')) {
        next.add('Jouer')
      }

      return next
    })
  }, [location.pathname, location.search])

  function toggleGroup(label: string) {
    setExpandedGroups((current) => {
      const next = new Set(current)

      if (next.has(label)) {
        next.delete(label)
      } else {
        next.add(label)
      }

      return next
    })
  }

  function handleLogout() {
    setDrawerOpen(false)
    onLogout()
  }

  return (
    <div className={authenticated ? `app-shell authenticated-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}` : 'app-shell'}>
      <Topbar
        authenticated={authenticated}
        drawerOpen={drawerOpen}
        notificationsSlot={notificationsSlot}
        onToggleDrawer={() => setDrawerOpen((current) => !current)}
      />

      {authenticated ? (
        <>
          <DesktopSidebar
            collapsed={sidebarCollapsed}
            displayName={displayName}
            user={displayUser}
            context={context}
            expandedGroups={expandedGroups}
            presenceSlot={presenceSlot?.('sidebar-presence-control')}
            isAdmin={isAdmin}
            onToggleCollapsed={() => setSidebarCollapsed((current) => !current)}
            onToggleGroup={toggleGroup}
            onLogout={handleLogout}
          />
          <MobileBottomNav context={context} isAdmin={isAdmin} />
          <MobileDrawer
            displayName={displayName}
            open={drawerOpen}
            presenceSlot={presenceSlot?.('mobile-presence-control')}
            isAdmin={isAdmin}
            context={context}
            expandedGroups={expandedGroups}
            onClose={() => setDrawerOpen(false)}
            onLogout={handleLogout}
            onToggleGroup={toggleGroup}
          />
        </>
      ) : null}

      <main className="main-content">{children}</main>
    </div>
  )
}
