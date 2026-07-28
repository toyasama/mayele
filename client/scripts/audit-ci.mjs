import { spawnSync } from 'node:child_process'

const minimumSeverity = 'moderate'
const severityRank = new Map([
  ['info', 0],
  ['low', 1],
  ['moderate', 2],
  ['high', 3],
  ['critical', 4],
])

// This Vite SPA does not use React Router's RSC mode, which is the only
// affected code path. Remove this exception as soon as a patched release is
// available: https://github.com/advisories/GHSA-qwww-vcr4-c8h2
const allowedAdvisories = new Set(['GHSA-qwww-vcr4-c8h2'])

const npmCli = process.env.npm_execpath
if (!npmCli) {
  console.error('npm_execpath is unavailable; run this check through npm run audit:ci.')
  process.exit(1)
}

const audit = spawnSync(
  process.execPath,
  [npmCli, 'audit', '--json', `--audit-level=${minimumSeverity}`],
  { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
)

if (audit.error) {
  console.error(`Unable to run npm audit: ${audit.error.message}`)
  process.exit(1)
}

let report
try {
  report = JSON.parse(audit.stdout)
} catch {
  console.error('npm audit did not return valid JSON.')
  if (audit.stderr) console.error(audit.stderr.trim())
  process.exit(1)
}

const vulnerabilities = report.vulnerabilities ?? {}
const allowedPackages = new Set()

function advisoryId(via) {
  if (typeof via !== 'object' || via === null) return null
  const match = via.url?.match(/(GHSA-[\w-]+)$/)
  return match?.[1] ?? null
}

let changed = true
while (changed) {
  changed = false

  for (const [name, vulnerability] of Object.entries(vulnerabilities)) {
    if (allowedPackages.has(name)) continue

    const via = vulnerability.via ?? []
    const isAllowed = via.length > 0 && via.every((cause) => {
      if (typeof cause === 'string') return allowedPackages.has(cause)
      const id = advisoryId(cause)
      return id !== null && allowedAdvisories.has(id)
    })

    if (isAllowed) {
      allowedPackages.add(name)
      changed = true
    }
  }
}

const threshold = severityRank.get(minimumSeverity)
const blocking = Object.entries(vulnerabilities).filter(([name, vulnerability]) => {
  const rank = severityRank.get(vulnerability.severity) ?? Number.POSITIVE_INFINITY
  return rank >= threshold && !allowedPackages.has(name)
})

for (const id of allowedAdvisories) {
  const matched = Object.values(vulnerabilities).some((vulnerability) =>
    (vulnerability.via ?? []).some((cause) => advisoryId(cause) === id),
  )
  if (matched) console.warn(`Allowed npm advisory ${id}: React Router RSC mode is not used by this application.`)
}

if (blocking.length > 0) {
  console.error(`npm audit found ${blocking.length} blocking package finding(s):`)
  for (const [name, vulnerability] of blocking) {
    console.error(`- ${name}: ${vulnerability.severity}`)
  }
  process.exit(1)
}

console.log(`npm audit passed at ${minimumSeverity} severity with ${allowedPackages.size} allowlisted package finding(s).`)
