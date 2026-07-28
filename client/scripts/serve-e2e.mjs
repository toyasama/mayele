import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const clientRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const viteCli = join(clientRoot, 'node_modules', 'vite', 'bin', 'vite.js')
const outDir = process.env.E2E_DIST_DIR?.trim() || 'dist'
const e2eEnvironment = {
  ...process.env,
  // The E2E bundle deliberately targets a local HTTP API. This is a build
  // setting only: the browser is still served from the compiled `dist` files.
  NODE_ENV: 'development',
}

function runVite(args) {
  return new Promise((resolve, reject) => {
    const viteProcess = spawn(process.execPath, [viteCli, ...args], {
      cwd: clientRoot,
      env: e2eEnvironment,
      stdio: 'inherit',
    })

    viteProcess.once('error', reject)
    viteProcess.once('exit', (code, signal) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(`Vite ${args[0]} failed (${signal ?? `exit ${code ?? 'unknown'}`}).`))
    })
  })
}

await runVite(['build', '--mode', 'e2e', '--outDir', outDir])

const preview = spawn(process.execPath, [viteCli, 'preview', '--host', '127.0.0.1', '--outDir', outDir, ...process.argv.slice(2)], {
  cwd: clientRoot,
  env: e2eEnvironment,
  stdio: 'inherit',
})

function stopPreview() {
  preview.kill('SIGTERM')
}

process.once('SIGINT', stopPreview)
process.once('SIGTERM', stopPreview)
preview.once('error', (error) => {
  throw error
})
preview.once('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0)
})
