import { getDb, daemonStateRepo } from '@mas/db'
import { acquireProcessLock, type ProcessLockHandle } from './lock'
import type { DaemonRunnerOptions, LoggerLike } from './types'

const DEFAULT_TICK_INTERVAL_MS = 5_000

function formatError(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

export class DaemonRunner {
  private readonly options: Required<Pick<DaemonRunnerOptions, 'dbPath' | 'lockPath'>> & {
    pid: number
    tickIntervalMs: number
    tick?: DaemonRunnerOptions['tick']
    logger: LoggerLike
  }

  private readonly abortController = new AbortController()
  private lockHandle: ProcessLockHandle | null = null
  private intervalHandle: NodeJS.Timeout | null = null
  private inFlightTick: Promise<void> | null = null
  private running = false
  private stopping = false

  constructor(options: DaemonRunnerOptions) {
    this.options = {
      dbPath: options.dbPath,
      lockPath: options.lockPath,
      pid: options.pid ?? process.pid,
      tickIntervalMs: options.tickIntervalMs ?? DEFAULT_TICK_INTERVAL_MS,
      tick: options.tick,
      logger: options.logger ?? console,
    }
  }

  async start() {
    if (this.running) {
      return
    }

    getDb(this.options.dbPath)
    this.lockHandle = await acquireProcessLock({
      lockPath: this.options.lockPath,
      pid: this.options.pid,
      metadata: {
        dbPath: this.options.dbPath,
      },
    })

    daemonStateRepo.markDaemonRunning({
      pid: this.options.pid,
    })

    this.running = true
    this.stopping = false
    this.intervalHandle = setInterval(() => {
      void this.runTick()
    }, this.options.tickIntervalMs)
  }

  async stop() {
    if (!this.running || this.stopping) {
      return
    }

    this.stopping = true
    this.running = false
    this.abortController.abort()

    if (this.intervalHandle) {
      clearInterval(this.intervalHandle)
      this.intervalHandle = null
    }

    if (this.inFlightTick) {
      await this.inFlightTick
    }

    daemonStateRepo.markDaemonStopping({
      pid: this.options.pid,
    })

    await this.lockHandle?.release()
    this.lockHandle = null

    daemonStateRepo.markDaemonStopped({
      pid: this.options.pid,
    })
  }

  private async runTick() {
    if (this.stopping || this.inFlightTick) {
      return
    }

    this.inFlightTick = (async () => {
      daemonStateRepo.markDaemonHeartbeat({
        pid: this.options.pid,
      })

      try {
        await this.options.tick?.({
          signal: this.abortController.signal,
        })
      } catch (error) {
        const message = formatError(error)
        daemonStateRepo.recordDaemonError(message)
        this.options.logger.error?.(`[daemon] tick failed: ${message}`)
      } finally {
        this.inFlightTick = null
      }
    })()

    await this.inFlightTick
  }
}
