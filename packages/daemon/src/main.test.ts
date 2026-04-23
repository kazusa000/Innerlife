import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import Database from 'better-sqlite3'
import { loadEnvFile } from './main'

function readState(dbPath: string) {
  const db = new Database(dbPath, { readonly: true })

  try {
    return db.prepare(`
      SELECT
        pid as pid,
        status as status,
        started_at as startedAt,
        last_heartbeat_at as lastHeartbeatAt,
        stopped_at as stoppedAt
      FROM daemon_state
      WHERE id = 'local'
    `).get() as {
      pid: number
      status: string
      startedAt: number
      lastHeartbeatAt: number
      stoppedAt: number | null
    } | undefined
  } finally {
    db.close()
  }
}

async function waitFor(assertion: () => void | Promise<void>, timeoutMs = 4000) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    try {
      await assertion()
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }

  await assertion()
}

test('loadEnvFile loads missing values from .env without overriding existing env', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-daemon-env-'))
  const envPath = join(dir, '.env')
  const previousOpenRouter = process.env.OPENROUTER_API_KEY
  const previousAnthropic = process.env.ANTHROPIC_API_KEY
  const previousObserver = process.env.OBSERVER_ENABLED

  writeFileSync(envPath, [
    'OPENROUTER_API_KEY=from-dotenv',
    'ANTHROPIC_API_KEY=from-dotenv-anthropic',
    'OBSERVER_ENABLED=1',
  ].join('\n'))

  process.env.OPENROUTER_API_KEY = 'from-process'
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.OBSERVER_ENABLED

  try {
    loadEnvFile(envPath)

    assert.equal(process.env.OPENROUTER_API_KEY, 'from-process')
    assert.equal(process.env.ANTHROPIC_API_KEY, 'from-dotenv-anthropic')
    assert.equal(process.env.OBSERVER_ENABLED, '1')
  } finally {
    if (previousOpenRouter === undefined) {
      delete process.env.OPENROUTER_API_KEY
    } else {
      process.env.OPENROUTER_API_KEY = previousOpenRouter
    }

    if (previousAnthropic === undefined) {
      delete process.env.ANTHROPIC_API_KEY
    } else {
      process.env.ANTHROPIC_API_KEY = previousAnthropic
    }

    if (previousObserver === undefined) {
      delete process.env.OBSERVER_ENABLED
    } else {
      process.env.OBSERVER_ENABLED = previousObserver
    }

    rmSync(dir, { recursive: true, force: true })
  }
})

test('main exits cleanly on SIGTERM and releases the lock', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-daemon-main-'))
  const dbPath = join(dir, 'daemon.db')
  const lockPath = join(dir, 'daemon.lock')

  const child = spawn(
    process.execPath,
    ['--import', 'tsx', 'packages/daemon/src/main.ts'],
    {
      cwd: join(import.meta.dirname, '..', '..', '..'),
      env: {
        ...process.env,
        MAS_DAEMON_DB_PATH: dbPath,
        MAS_DAEMON_LOCK_PATH: lockPath,
        MAS_DAEMON_TICK_INTERVAL_MS: '25',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )

  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString()
  })
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString()
  })

  try {
    await waitFor(() => {
      const state = readState(dbPath)
      assert.equal(state?.status, 'running')
      assert.equal(state?.pid, child.pid)
      assert.equal(existsSync(lockPath), true)
    })

    child.kill('SIGTERM')
    const [code, signal] = await once(child, 'exit') as [number | null, NodeJS.Signals | null]

    assert.equal(signal, null)
    assert.equal(code, 0, `stdout:\n${stdout}\n\nstderr:\n${stderr}`)

    await waitFor(() => {
      const state = readState(dbPath)
      assert.equal(state?.status, 'stopped')
      assert.ok(typeof state?.stoppedAt === 'number')
      assert.equal(existsSync(lockPath), false)
    })
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL')
      await once(child, 'exit')
    }
    rmSync(dir, { recursive: true, force: true })
  }
})
