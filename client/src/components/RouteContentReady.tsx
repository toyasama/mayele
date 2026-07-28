import { useEffect } from 'react'

type RouteContentReadyProps = {
  routeKey: string
  onReady: (routeKey: string) => void
}

export function RouteContentReady({ routeKey, onReady }: RouteContentReadyProps) {
  useEffect(() => {
    const measuredWindow = window as typeof window & {
      __mayeleRouteContentReadyAt?: number
      __mayeleRouteContentReadyKey?: string
    }

    // StrictMode rejoue les effets au montage. Conserver la premiere mesure de
    // la navigation evite de transformer ce second passage en faux retard UI.
    if (measuredWindow.__mayeleRouteContentReadyKey !== routeKey) {
      measuredWindow.__mayeleRouteContentReadyAt = performance.now()
      measuredWindow.__mayeleRouteContentReadyKey = routeKey
      performance.mark('mayele:route-content-ready')
    }
    onReady(routeKey)
  }, [onReady, routeKey])

  return null
}
