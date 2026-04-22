import path from 'node:path'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { bootstrapAppDatabases, daemonEventRepo } from '@mas/db'
import { processNextQueuedTuringRun } from '@mas/turing'
import { processMemoryJobs } from './memory-jobs'
import { ManagedLtpSidecar } from './ltp-sidecar'
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
      await processMemoryJobs(signal)
      await processNextQueuedTuringRun(signal)
    },
  })
  const ltpSidecar = new ManagedLtpSidecar({
    baseUrl: process.env.MAS_LTP_BASE_URL,
    repoRoot: REPO_ROOT,
    logger: console,
  })

  await runner.start()
  if (ltpSidecar.isManaged()) {
    daemonEventRepo.appendEvent({
      kind: 'ltp_starting',
      scope: 'daemon',
      message: 'LTP sidecar 正在启动',
      payload: {
        baseUrl: process.env.MAS_LTP_BASE_URL ?? null,
      },
    })
    try {
      await ltpSidecar.start()
      daemonEventRepo.appendEvent({
        kind: 'ltp_started',
        scope: 'daemon',
        message: 'LTP sidecar 已启动',
        payload: {
          baseUrl: process.env.MAS_LTP_BASE_URL ?? null,
        },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      daemonEventRepo.appendEvent({
        kind: 'ltp_error',
        scope: 'daemon',
        message: `LTP sidecar 启动失败：${message}`,
        payload: {
          baseUrl: process.env.MAS_LTP_BASE_URL ?? null,
          error: message,
        },
      })
      await runner.stop()
      throw error
    }
  }
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
    if (ltpSidecar.isManaged()) {
      daemonEventRepo.appendEvent({
        kind: 'ltp_stopping',
        scope: 'daemon',
        message: 'LTP sidecar 正在停止',
        payload: {
          baseUrl: process.env.MAS_LTP_BASE_URL ?? null,
        },
      })
      await ltpSidecar.stop()
      daemonEventRepo.appendEvent({
        kind: 'ltp_stopped',
        scope: 'daemon',
        message: 'LTP sidecar 已停止',
        payload: {
          baseUrl: process.env.MAS_LTP_BASE_URL ?? null,
        },
      })
    }
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

  await shutdownPromise
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error)
    console.error(`[daemon] fatal: ${message}`)
    process.exitCode = 1
  })
}
