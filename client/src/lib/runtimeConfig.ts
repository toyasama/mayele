const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

type RuntimeConfigOptions = {
  isProduction?: boolean
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '')
}

function currentPageHostname() {
  return typeof window === 'undefined' ? 'localhost' : window.location.hostname
}

function currentPageOrigin() {
  return typeof window === 'undefined' ? 'http://localhost:5173' : window.location.origin
}

function isLocalHostname(hostname: string) {
  return LOCAL_HOSTS.has(hostname)
}

function configurationError(message: string) {
  return new Error(`Configuration frontend invalide: ${message}`)
}

function resolveApiUrl(configuredApiBase: string, pageHostname: string) {
  try {
    const apiUrl = new URL(configuredApiBase)

    if (isLocalHostname(apiUrl.hostname) && !isLocalHostname(pageHostname)) {
      return null
    }

    return apiUrl
  } catch {
    return null
  }
}

export function resolveApiBase(
  configuredApiBase: string | undefined,
  pageHostname = currentPageHostname(),
  options: RuntimeConfigOptions = {},
) {
  const value = configuredApiBase?.trim()

  if (!value) {
    if (options.isProduction) {
      throw configurationError('VITE_API_URL doit etre defini en production.')
    }

    return '/api'
  }

  const apiUrl = resolveApiUrl(value, pageHostname)

  if (apiUrl === null) {
    try {
      new URL(value)
    } catch {
      if (options.isProduction) {
        throw configurationError('VITE_API_URL doit etre une URL absolue valide en production.')
      }

      return value
    }

    if (options.isProduction) {
      throw configurationError('VITE_API_URL ne doit pas pointer vers localhost depuis un build production.')
    }

    return '/api'
  }

  if (options.isProduction && apiUrl.protocol !== 'https:') {
    throw configurationError('VITE_API_URL doit utiliser HTTPS en production.')
  }

  const normalizedPathname = apiUrl.pathname.replace(/\/+$/, '')
  if (options.isProduction && normalizedPathname !== '/api') {
    throw configurationError('VITE_API_URL doit cibler la racine /api du backend.')
  }

  return trimTrailingSlash(value)
}

export function resolveRealtimeBase({
  configuredRealtimeBase,
  configuredApiBase,
  pageHostname = currentPageHostname(),
  pageOrigin = currentPageOrigin(),
  isProduction = false,
}: {
  configuredRealtimeBase?: string
  configuredApiBase?: string
  pageHostname?: string
  pageOrigin?: string
  isProduction?: boolean
}) {
  if (configuredRealtimeBase?.trim()) {
    const value = configuredRealtimeBase.trim()

    try {
      const realtimeUrl = new URL(value)

      if (isProduction && realtimeUrl.protocol !== 'https:') {
        throw configurationError('VITE_REALTIME_URL doit utiliser HTTPS en production.')
      }
    } catch (error) {
      if (isProduction) {
        if (error instanceof Error && error.message.startsWith('Configuration frontend invalide:')) {
          throw error
        }

        throw configurationError('VITE_REALTIME_URL doit etre une URL absolue valide en production.')
      }
    }

    return trimTrailingSlash(value)
  }

  if (!configuredApiBase?.trim()) {
    if (isProduction) {
      throw configurationError('VITE_API_URL doit etre defini pour resoudre le websocket en production.')
    }

    return trimTrailingSlash(pageOrigin)
  }

  const apiUrl = resolveApiUrl(configuredApiBase.trim(), pageHostname)

  if (apiUrl === null) {
    if (isProduction) {
      throw configurationError('VITE_API_URL doit etre une URL backend joignable pour le websocket en production.')
    }

    return trimTrailingSlash(pageOrigin)
  }

  if (isProduction && apiUrl.protocol !== 'https:') {
    throw configurationError('Le websocket derive de VITE_API_URL doit utiliser HTTPS en production.')
  }

  return trimTrailingSlash(apiUrl.origin)
}
