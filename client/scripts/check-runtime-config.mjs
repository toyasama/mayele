import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const envFiles = ['.env', '.env.local', '.env.production', '.env.production.local']

function parseEnvFile(path) {
  if (!existsSync(path)) {
    return {}
  }

  const entries = {}

  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()

    if (!line || line.startsWith('#') || !line.includes('=')) {
      continue
    }

    const index = line.indexOf('=')
    const key = line.slice(0, index).trim()
    let value = line.slice(index + 1).trim()

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }

    entries[key] = value
  }

  return entries
}

function loadViteProductionEnv() {
  const fileEnv = envFiles.reduce(
    (current, file) => ({
      ...current,
      ...parseEnvFile(resolve(process.cwd(), file)),
    }),
    {},
  )

  return {
    ...fileEnv,
    ...process.env,
  }
}

function fail(message) {
  console.error(`Configuration frontend invalide: ${message}`)
  process.exit(1)
}

function requireHttpsUrl(value, name) {
  if (!value?.trim()) {
    fail(`${name} doit etre defini pour un build production.`)
  }

  let url

  try {
    url = new URL(value.trim())
  } catch {
    fail(`${name} doit etre une URL absolue valide.`)
  }

  if (url.protocol !== 'https:') {
    fail(`${name} doit utiliser HTTPS.`)
  }

  return url
}

const env = loadViteProductionEnv()
const apiUrl = requireHttpsUrl(env.VITE_API_URL, 'VITE_API_URL')
const apiPathname = apiUrl.pathname.replace(/\/+$/, '')

if (apiPathname !== '/api') {
  fail('VITE_API_URL doit cibler la racine /api du backend.')
}

if (env.VITE_REALTIME_URL?.trim()) {
  const realtimeUrl = requireHttpsUrl(env.VITE_REALTIME_URL, 'VITE_REALTIME_URL')
  const realtimePathname = realtimeUrl.pathname.replace(/\/+$/, '')

  if (realtimePathname) {
    fail('VITE_REALTIME_URL doit cibler uniquement l origine realtime, sans chemin.')
  }
}

const realtimeOrigin = env.VITE_REALTIME_URL?.trim() || apiUrl.origin
console.log(`Config frontend production OK: API=${apiUrl.origin}${apiUrl.pathname}, realtime=${realtimeOrigin}`)

