import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getDb, getRawSqlite, resetDb, daemonStateRepo } from '@mas/db'
import { DaemonRunner } from './runner'

async function waitFor(assertion: () => void | Promise<void>, timeoutMs = 1000) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    try {
      await assertion()
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }

  await assertion()
}

function bootstrapDb(dbPath: string) {
  resetDb()
  getDb(dbPath)
  getRawSqlite().exec(`
    CREATE TABLE daemon_state (
      id TEXT PRIMARY KEY NOT NULL,
      pid INTEGER NOT NULL,
      status TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      last_heartbeat_at INTEGER NOT NULL,
      stopped_at INTEGER,
      last_error TEXT,
      updated_at INTEGER NOT NULL
    );
  `)
}

test('DaemonRunner persists running heartbeat state and marks stopped on shutdown', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-daemon-runner-'))
  const dbPath = join(dir, 'daemon.db')
  const lockPath = join(dir, 'daemon.lock')
  let runner: DaemonRunner | undefined

  try {
    bootstrapDb(dbPath)

    runner = new DaemonRunner({
      dbPath,
      lockPath,
      pid: 5201,
      tickIntervalMs: 25,
    })

    await runner.start()

    const started = daemonStateRepo.getDaemonState()
    assert.equal(started?.status, 'running')
    assert.equal(started?.pid, 5201)
    assert.ok(started?.startedAt instanceof Date)
    assert.ok(started?.lastHeartbeatAt instanceof Date)
    assert.equal(existsSync(lockPath), true)

    await waitFor(() => {
      const current = daemonStateRepo.getDaemonState()
      assert.ok(current)
      assert.ok(current.lastHeartbeatAt.getTime() > started.lastHeartbeatAt.getTime())
    })

    await runner.stop()

    const stopped = daemonStateRepo.getDaemonState()
    assert.equal(stopped?.status, 'stopped')
    assert.equal(existsSync(lockPath), false)
    assert.ok(stopped?.stoppedAt instanceof Date)
  } finally {
    await runner?.stop()
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('DaemonRunner isolates tick failures and keeps subsequent ticks alive', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-daemon-runner-'))
  const dbPath = join(dir, 'daemon.db')
  const lockPath = join(dir, 'daemon.lock')
  let runner: DaemonRunner | undefined

  try {
    bootstrapDb(dbPath)

    let attempts = 0
    runner = new DaemonRunner({
      dbPath,
      lockPath,
      pid: 5202,
      tickIntervalMs: 15,
      tick: async () => {
        attempts += 1
        if (attempts === 1) {
          throw new Error('tick exploded once')
        }
      },
    })

    await runner.start()

    await waitFor(() => {
      assert.ok(attempts >= 2)
    })

    const state = daemonStateRepo.getDaemonState()
    assert.equal(state?.status, 'running')
    assert.equal(state?.lastError, 'tick exploded once')

    await runner.stop()
  } finally {
    await runner?.stop()
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})
