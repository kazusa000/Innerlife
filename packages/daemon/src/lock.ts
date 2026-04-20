import { mkdir, open, readFile, rm } from 'node:fs/promises'
import { dirname } from 'node:path'

export class ProcessLockError extends Error {}

export interface ProcessLockHandle {
  release: () => Promise<void>
}

interface AcquireProcessLockOptions {
  lockPath: string
  pid?: number
  metadata?: Record<string, unknown>
  isProcessAlive?: (pid: number) => boolean | Promise<boolean>
}

interface LockFilePayload {
  pid: number
  acquiredAt: string
  metadata: Record<string, unknown>
}

function defaultIsProcessAlive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : ''

    return code === 'EPERM'
  }
}

async function readLockPayload(lockPath: string) {
  try {
    const content = await readFile(lockPath, 'utf8')
    return JSON.parse(content) as LockFilePayload
  } catch {
    return undefined
  }
}

export async function acquireProcessLock(options: AcquireProcessLockOptions): Promise<ProcessLockHandle> {
  const pid = options.pid ?? process.pid
  const isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive

  await mkdir(dirname(options.lockPath), { recursive: true })

  try {
    const handle = await open(options.lockPath, 'wx')
    let released = false

    await handle.writeFile(JSON.stringify({
      pid,
      acquiredAt: new Date().toISOString(),
      metadata: options.metadata ?? {},
    }, null, 2))

    return {
      release: async () => {
        if (released) {
          return
        }

        released = true
        await handle.close()
        await rm(options.lockPath, { force: true })
      },
    }
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : ''

    if (code !== 'EEXIST') {
      throw error
    }

    const currentOwner = await readLockPayload(options.lockPath)
    if (currentOwner && !(await isProcessAlive(currentOwner.pid))) {
      await rm(options.lockPath, { force: true })
      return acquireProcessLock(options)
    }

    const details = currentOwner
      ? ` (pid ${currentOwner.pid})`
      : ''
    throw new ProcessLockError(`Daemon is already running${details}. Remove the lock file if it is stale.`)
  }
}
