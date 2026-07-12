export function isLocalDevOrigin(origin: string) {
  try {
    const { hostname, protocol } = new URL(origin)

    if (protocol !== 'http:' && protocol !== 'https:') {
      return false
    }

    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '[::1]' ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('10.') ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
    )
  } catch {
    return false
  }
}

export function isAllowedCorsOrigin(origin: string | undefined, options: { isProduction: boolean; allowedOrigins: string[] }) {
  if (!origin) {
    return true
  }

  if (!options.isProduction && isLocalDevOrigin(origin)) {
    return true
  }

  if (!options.isProduction && options.allowedOrigins.length === 0) {
    return true
  }

  return options.allowedOrigins.includes(origin)
}
