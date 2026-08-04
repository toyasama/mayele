import { Link } from 'react-router-dom'
import { isNavigationItemActive, navigationItemsForAccess, type NavigationMatchContext } from './navigation'

type MobileBottomNavProps = {
  context: NavigationMatchContext
  isAdmin?: boolean
}

export function MobileBottomNav({ context, isAdmin = false }: MobileBottomNavProps) {
  return (
    <nav className={isAdmin ? 'mobile-bottom-nav admin-visible' : 'mobile-bottom-nav'} aria-label="Navigation principale mobile">
      {navigationItemsForAccess(isAdmin).map((item) => {
        const active = isNavigationItemActive(item, context)

        return (
          <Link className={active ? 'mobile-bottom-link active' : 'mobile-bottom-link'} to={item.to} key={item.label} aria-current={active ? 'page' : undefined}>
            <span className="mobile-bottom-icon" aria-hidden="true">{item.icon}</span>
            <span>{item.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
