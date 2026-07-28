import type { ReactNode } from 'react'
import { DEFAULT_AUTHENTICATED_ROUTE } from '../../lib/routes'
import { DashboardNavIcon, DuelNavIcon, FriendsNavIcon } from './navigationIcons'

export type NavigationMatchContext = {
  pathname: string
  search: string
}

export type NavigationChildItem = {
  label: string
  to: string
  activeMatch?: (context: NavigationMatchContext) => boolean
}

export type NavigationItem = {
  label: string
  to: string
  icon: ReactNode
  children?: NavigationChildItem[]
  activeMatch?: (context: NavigationMatchContext) => boolean
}

export const mainNavigationItems: NavigationItem[] = [
  {
    label: 'Jouer',
    to: DEFAULT_AUTHENTICATED_ROUTE,
    icon: <DuelNavIcon />,
    activeMatch: ({ pathname }) => pathname.startsWith('/jeu'),
    children: [
      { label: 'Solo', to: '/jeu/solo', activeMatch: ({ pathname }) => pathname === '/jeu/solo' },
      { label: 'Multijoueur', to: '/jeu/multijoueur', activeMatch: ({ pathname }) => pathname === '/jeu/multijoueur' },
    ],
  },
  {
    label: 'Mon espace',
    to: '/dashboard',
    icon: <DashboardNavIcon />,
    activeMatch: ({ pathname }) => pathname === '/dashboard',
  },
  {
    label: 'Amis',
    to: '/amis',
    icon: <FriendsNavIcon />,
    activeMatch: ({ pathname }) => pathname.startsWith('/amis'),
  },
]

export function isNavigationItemActive(item: NavigationItem | NavigationChildItem, context: NavigationMatchContext) {
  if (item.activeMatch) {
    return item.activeMatch(context)
  }

  return context.pathname === item.to
}
