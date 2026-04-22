import path from 'node:path'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { bootstrapAppDatabases } from '@mas/db'
import { processNextQueuedTuringRun } from '@mas/turing'
import { DaemonRunner } from './runner'

const DEFAULT_TICK_INTERVAL_MS = 5_000
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

function resolveEnvPath(value: string | undefined, fallback: string) {
  if (!value) {
    return fallback
  }

  return path.isAbsolute(value)
    ? value
    : path.resolve(process.cwd(), value)
}

function readTickInterval() {
  const raw = process.env.MAS_DAEMON_TICK_INTERVAL_MS
  if (!raw) {
    return DEFAULT_TICK_INTERVAL_MS
  }

  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_TICK_INTERVAL_MS
}

export async function main() {
  const dbPath = resolveEnvPath(
    process.env.MAS_DAEMON_DB_PATH,
    path.resolve(REPO_ROOT, 'data.db'),
  )
  const memoryDbPath = resolveEnvPath(
    process.env.MAS_MEMORY_DB_PATH,
    path.resolve(REPO_ROOT, 'storage', 'memory', 'memory.db'),
  )

  bootstrapAppDatabases({
    dbPath,
    memoryDbPath,
  })

  const runner = new DaemonRunner({
    dbPath,
    lockPath: resolveEnvPath(
      process.env.MAS_DAEMON_LOCK_PATH,
      path.resolve(REPO_ROOT, '.superpowers', 'daemon.lock'),
    ),
    tickIntervalMs: readTickInterval(),
    logger: console,
    tick: async ({ signal }) => {
      await processNextQueuedTuringRun(signal)
    },
  })

  await runner.start()
  console.info(`[daemon] running pid=${process.pid}`)

  let shuttingDown = false
  let resolveShutdown: (() => void) | null = null
  const shutdownPromise = new Promise<void>((resolve) => {
    resolveShutdown = resolve
  })

  const stop = async (signal: string) => {
    if (shuttingDown) {
      return
    }

    shuttingDown = true
    console.info(`[daemon] stopping via ${signal}`)
    await runner.stop()
    process.exitCode = 0
    resolveShutdown?.()
  }

  process.on('SIGINT', () => {
    void stop('SIGINT')
  })
  process.on('SIGTERM', () => {
    void stop('SIGTERM')
  })

  await Promise.race([
    once(process, 'SIGINT'),
    once(process, 'SIGTERM'),
    shutdownPromise,
  ])
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error)
    console.error(`[daemon] fatal: ${message}`)
    process.exitCode = 1
  })
}
