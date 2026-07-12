import { Link } from 'react-router-dom'
import { isNavigationItemActive, mainNavigationItems, type NavigationMatchContext } from './navigation'

type MobileBottomNavProps = {
  context: NavigationMatchContext
}

export function MobileBottomNav({ context }: MobileBottomNavProps) {
  return (
    <nav className="mobile-bottom-nav" aria-label="Navigation principale mobile">
      {mainNavigationItems.map((item) => {
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
