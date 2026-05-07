import path from 'node:path'
import { once } from 'node:events'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { bootstrapAppDatabases, migrateLegacyAppDb } from '@mas/db'
import { processMemoryJobs } from './memory-jobs'
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

function parseEnvValue(raw: string) {
  const trimmed = raw.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith('\'') && trimmed.endsWith('\''))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

export function loadEnvFile(envPath: string) {
  if (!existsSync(envPath)) {
    return
  }

  const text = readFileSync(envPath, 'utf8')
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }

    const separatorIndex = trimmed.indexOf('=')
    if (separatorIndex <= 0) {
      continue
    }

    const key = trimmed.slice(0, separatorIndex).trim()
    if (!key || process.env[key] !== undefined) {
      continue
    }

    process.env[key] = parseEnvValue(trimmed.slice(separatorIndex + 1))
  }
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
  loadEnvFile(resolveEnvPath(
    process.env.MAS_DAEMON_ENV_PATH,
    path.resolve(REPO_ROOT, '.env'),
  ))

  const dbPath = resolveEnvPath(
    process.env.MAS_DAEMON_DB_PATH,
    path.resolve(REPO_ROOT, 'storage', 'app', 'data.db'),
  )
  const memoryDbPath = resolveEnvPath(
    process.env.MAS_MEMORY_DB_PATH,
    path.resolve(REPO_ROOT, 'storage', 'memory', 'memory.db'),
  )

  if (!process.env.MAS_DAEMON_DB_PATH) {
    migrateLegacyAppDb({
      legacyPath: path.resolve(REPO_ROOT, 'data.db'),
      targetPath: dbPath,
    })
  }

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
      await processMemoryJobs(signal)
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
