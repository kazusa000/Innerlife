import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import path from 'node:path'
import type { LoggerLike } from './types'

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function isManagedLtpBaseUrl(baseUrl: string | undefined) {
  if (!baseUrl) {
    return false
  }

  try {
    const url = new URL(baseUrl)
    return url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
  } catch {
    return false
  }
}

interface ManagedLtpSidecarOptions {
  baseUrl?: string
  repoRoot?: string
  logger?: LoggerLike
  command?: [string, ...string[]]
  spawnImpl?: typeof spawn
  fetchImpl?: typeof fetch
  startupTimeoutMs?: number
}

export class ManagedLtpSidecar {
  private readonly baseUrl: string | undefined
  private readonly logger: LoggerLike
  private readonly spawnImpl: typeof spawn
  private readonly fetchImpl: typeof fetch
  private readonly command: [string, ...string[]]
  private readonly startupTimeoutMs: number
  private child: ChildProcess | null = null

  constructor(options: ManagedLtpSidecarOptions) {
    this.baseUrl = options.baseUrl
    this.logger = options.logger ?? console
    this.spawnImpl = options.spawnImpl ?? spawn
    this.fetchImpl = options.fetchImpl ?? fetch
    this.startupTimeoutMs = options.startupTimeoutMs ?? 20_000

    if (options.command) {
      this.command = options.command
    } else {
      const repoRoot = options.repoRoot ?? process.cwd()
      this.command = [
        path.resolve(repoRoot, '.venv', 'bin', 'python'),
        path.resolve(repoRoot, 'scripts', 'ltp_service.py'),
      ]
    }
  }

  isManaged() {
    return isManagedLtpBaseUrl(this.baseUrl)
  }

  async start() {
    if (!this.isManaged() || this.child) {
      return
    }

    const [command, ...args] = this.command
    const spawnOptions: SpawnOptions = {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    }

    const child = this.spawnImpl(command, args, spawnOptions)
    this.child = child

    let stderr = ''
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.stdout?.on('data', (chunk) => {
      this.logger.info?.(`[ltp] ${chunk.toString().trim()}`)
    })

    const startedAt = Date.now()
    while (Date.now() - startedAt < this.startupTimeoutMs) {
      if (child.exitCode !== null || child.killed) {
        this.child = null
        throw new Error(`LTP sidecar exited during startup${stderr ? `: ${stderr.trim()}` : ''}`)
      }

      try {
        const response = await this.fetchImpl(`${this.baseUrl}/health`)
        if (response.ok) {
          return
        }
      } catch {
        // keep polling until timeout
      }

      await delay(100)
    }

    await this.stop()
    throw new Error('LTP sidecar did not become healthy before timeout')
  }

  async stop() {
    if (!this.child) {
      return
    }

    const child = this.child
    this.child = null

    if (child.exitCode !== null) {
      return
    }

    const exited = new Promise<void>((resolve) => {
      child.once('exit', () => resolve())
    })

    child.kill('SIGTERM')
    const timeout = delay(5_000).then(() => false)
    const didExit = await Promise.race([exited.then(() => true), timeout])
    if (!didExit && child.exitCode === null) {
      child.kill('SIGKILL')
      await exited
    }
  }
}
