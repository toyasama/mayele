import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const serverRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const npmCli = process.env.npm_execpath
const tsxCli = join(serverRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs')
const e2eEnvironment = {
  ...process.env,
  NODE_ENV: 'test',
  E2E_AUTH_BYPASS: 'true',
}

function runNodeScript(scriptPath, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: serverRoot,
      stdio: 'inherit',
      ...options,
    })

    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`${scriptPath} ${args.join(' ')} exited with code ${code}`))
      }
    })
  })
}

if (!npmCli) {
  throw new Error('npm_execpath is required to run the E2E development server.')
}

if (!existsSync(tsxCli)) {
  throw new Error('tsx is not installed. Run npm install in the server workspace.')
}

await runNodeScript(npmCli, ['run', 'prisma:generate'], { env: e2eEnvironment })

const server = spawn(process.execPath, [tsxCli, 'watch', '--exclude', 'src/generated/**', 'src/server.ts'], {
  cwd: serverRoot,
  stdio: 'inherit',
  env: e2eEnvironment,
})

server.once('error', (error) => {
  throw error
})

const shutdown = () => {
  server.kill('SIGTERM')
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
