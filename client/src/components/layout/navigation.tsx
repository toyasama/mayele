import type { ReactNode } from 'react'
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

function dashboardViewIs(view: 'overview' | 'stats' | 'missions' | 'history') {
  return ({ pathname, search }: NavigationMatchContext) => {
    if (pathname !== '/dashboard') {
      return false
    }

    const params = new URLSearchParams(search)
    const activeView = params.get('view') ?? 'overview'
    return activeView === view
  }
}

export const mainNavigationItems: NavigationItem[] = [
  {
    label: 'Mon espace',
    to: '/dashboard',
    icon: <DashboardNavIcon />,
    activeMatch: ({ pathname }) => pathname === '/dashboard',
    children: [
      { label: "Vue d'ensemble", to: '/dashboard', activeMatch: dashboardViewIs('overview') },
      { label: 'Statistiques', to: '/dashboard?view=stats', activeMatch: dashboardViewIs('stats') },
      { label: 'Missions', to: '/dashboard?view=missions', activeMatch: dashboardViewIs('missions') },
      { label: 'Historique', to: '/dashboard?view=history', activeMatch: dashboardViewIs('history') },
    ],
  },
  {
    label: 'Jouer',
    to: '/jeu/solo',
    icon: <DuelNavIcon />,
    activeMatch: ({ pathname }) => pathname.startsWith('/jeu'),
    children: [
      { label: 'Solo', to: '/jeu/solo', activeMatch: ({ pathname }) => pathname === '/jeu/solo' },
      { label: 'Multijoueur', to: '/jeu/multijoueur', activeMatch: ({ pathname }) => pathname === '/jeu/multijoueur' },
    ],
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
