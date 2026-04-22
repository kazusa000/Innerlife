import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getDb, getRawSqlite, resetDb, daemonEventRepo } from '..'

function bootstrapDb(dbPath: string) {
  resetDb()
  getDb(dbPath)
  getRawSqlite().exec(`
    CREATE TABLE daemon_events (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      scope TEXT NOT NULL,
      message TEXT NOT NULL,
      payload_json TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX idx_daemon_events_created_at ON daemon_events(created_at);
    CREATE INDEX idx_daemon_events_scope_created_at ON daemon_events(scope, created_at);
  `)
}

test('daemonEventRepo appends payloads and lists newest-first with optional scope filter', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-daemon-events-'))
  const dbPath = join(dir, 'test.db')

  try {
    bootstrapDb(dbPath)

    const first = daemonEventRepo.appendEvent({
      kind: 'heartbeat',
      scope: 'daemon',
      message: 'daemon heartbeat',
      payload: { pid: 100 },
      createdAt: new Date('2026-04-22T09:00:00.000Z'),
    })
    const second = daemonEventRepo.appendEvent({
      kind: 'sleep_success',
      scope: 'memory_sleep',
      message: 'sleep completed',
      payload: { agentId: 'agent-1', createdCount: 2 },
      createdAt: new Date('2026-04-22T09:05:00.000Z'),
    })
    const third = daemonEventRepo.appendEvent({
      kind: 'flush_success',
      scope: 'memory_flush',
      message: 'context flush completed',
      payload: { sessionId: 'session-1', createdCount: 3 },
      createdAt: new Date('2026-04-22T09:10:00.000Z'),
    })

    assert.deepEqual(
      daemonEventRepo.listEvents({ limit: 2 }).map((event) => event.id),
      [third.id, second.id],
    )
    assert.deepEqual(
      daemonEventRepo.listEvents({ scope: 'memory_sleep' }).map((event) => event.id),
      [second.id],
    )
    assert.deepEqual(first.payload, { pid: 100 })
    assert.deepEqual(second.payload, { agentId: 'agent-1', createdCount: 2 })
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})
