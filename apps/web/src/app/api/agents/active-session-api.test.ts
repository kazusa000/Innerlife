import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getDb, getRawSqlite, resetDb, sessionRepo } from '@mas/db'
import { resolveActiveSession } from './[id]/active-session/handler'

function bootstrapDb(dbPath: string) {
  resetDb()
  getDb(dbPath)
  getRawSqlite().exec(`
    CREATE TABLE agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      personality TEXT,
      skills TEXT,
      modules TEXT,
      status TEXT NOT NULL DEFAULT 'idle',
      model TEXT NOT NULL,
      config TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    );
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      title TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    );
  `)
  getRawSqlite().exec(`
    INSERT INTO agents (id, name, model, modules)
    VALUES ('agent-1', 'Hazel', 'deepseek-chat', '{"memory":{"scheme":"sqlite"}}');
    INSERT INTO agents (id, name, model, modules)
    VALUES ('agent-2', 'Orion', 'deepseek-chat', '{"memory":{"scheme":"noop"}}');
  `)
}

test('resolveActiveSession reuses the latest existing session for an agent', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-web-active-session-'))
  const dbPath = join(dir, 'test.db')

  try {
    bootstrapDb(dbPath)

    const older = sessionRepo.createSession('agent-1', 'older')
    const newer = sessionRepo.createSession('agent-1', 'newer')
    getRawSqlite().exec(`
      UPDATE sessions SET updated_at = 1713500000000 WHERE id = '${older.id}';
      UPDATE sessions SET updated_at = 1713600000000 WHERE id = '${newer.id}';
    `)

    const response = await resolveActiveSession('agent-1')

    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      session: {
        id: newer.id,
        agentId: 'agent-1',
        title: 'newer',
        status: 'active',
        createdAt: new Date(sessionRepo.getSession(newer.id)!.createdAt).toISOString(),
        updatedAt: new Date(1713600000000).toISOString(),
      },
    })
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('resolveActiveSession creates one session when the agent has none', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-web-active-session-'))
  const dbPath = join(dir, 'test.db')

  try {
    bootstrapDb(dbPath)

    const response = await resolveActiveSession('agent-2')
    const body = await response.json()

    assert.equal(response.status, 200)
    assert.equal(body.session.agentId, 'agent-2')
    assert.equal(typeof body.session.id, 'string')
    assert.equal(sessionRepo.listSessionsByAgent('agent-2').length, 1)
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('resolveActiveSession returns 404 for unknown agents', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-web-active-session-'))
  const dbPath = join(dir, 'test.db')

  try {
    bootstrapDb(dbPath)

    const response = await resolveActiveSession('missing-agent')

    assert.equal(response.status, 404)
    assert.deepEqual(await response.json(), {
      error: 'Not found',
    })
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('resolveActiveSession with reset creates a fresh active session and archives older ones', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-web-active-session-'))
  const dbPath = join(dir, 'test.db')

  try {
    bootstrapDb(dbPath)

    const older = sessionRepo.createSession('agent-1', 'older')
    const latest = sessionRepo.createSession('agent-1', 'latest')
    getRawSqlite().exec(`
      UPDATE sessions SET updated_at = 1713500000000 WHERE id = '${older.id}';
      UPDATE sessions SET updated_at = 1713600000000 WHERE id = '${latest.id}';
    `)

    const response = await resolveActiveSession('agent-1', { reset: true })
    const body = await response.json()
    const sessions = sessionRepo.listSessionsByAgent('agent-1')

    assert.equal(response.status, 200)
    assert.equal(body.session.agentId, 'agent-1')
    assert.notEqual(body.session.id, latest.id)
    assert.equal(sessionRepo.getLatestActiveSessionByAgent('agent-1')?.id, body.session.id)
    assert.equal(sessions.filter((session) => session.status === 'active').length, 1)
    assert.equal(sessionRepo.getSession(older.id)?.status, 'archived')
    assert.equal(sessionRepo.getSession(latest.id)?.status, 'archived')
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('resolveActiveSession flushes sqlite context before reset when flushContext is true', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-web-active-session-'))
  const dbPath = join(dir, 'test.db')

  try {
    bootstrapDb(dbPath)

    const older = sessionRepo.createSession('agent-1', 'older')
    const latest = sessionRepo.createSession('agent-1', 'latest')
    getRawSqlite().exec(`
      UPDATE sessions SET updated_at = 1713500000000 WHERE id = '${older.id}';
      UPDATE sessions SET updated_at = 1713600000000 WHERE id = '${latest.id}';
    `)
    const response = await resolveActiveSession('agent-1', {
      reset: true,
      flushContext: true,
      async runContextFlushForSession(input) {
        assert.deepEqual(input, {
          sessionId: latest.id,
          mode: 'manual',
        })
        assert.equal(sessionRepo.getSession(older.id)?.status, 'active')
        assert.equal(sessionRepo.getSession(latest.id)?.status, 'active')
        return {
          ok: true as const,
          mode: 'manual' as const,
          createdCount: 2,
          memoryIds: ['memory-1', 'memory-2'],
          nextActiveStartMessageId: 'message-9',
          flushedMessageCount: 8,
        }
      },
    })
    const body = await response.json()
    const sessions = sessionRepo.listSessionsByAgent('agent-1')

    assert.equal(response.status, 200)
    assert.equal(body.session.agentId, 'agent-1')
    assert.notEqual(body.session.id, latest.id)
    assert.deepEqual(body.contextFlush, {
      ok: true,
      mode: 'manual',
      createdCount: 2,
      memoryIds: ['memory-1', 'memory-2'],
      nextActiveStartMessageId: 'message-9',
      flushedMessageCount: 8,
    })
    assert.equal(sessions.filter((session) => session.status === 'active').length, 1)
    assert.equal(sessionRepo.getSession(older.id)?.status, 'archived')
    assert.equal(sessionRepo.getSession(latest.id)?.status, 'archived')
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('resolveActiveSession continues reset for soft flush results', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-web-active-session-'))
  const dbPath = join(dir, 'test.db')

  try {
    bootstrapDb(dbPath)

    const latest = sessionRepo.createSession('agent-1', 'latest')
    const response = await resolveActiveSession('agent-1', {
      reset: true,
      flushContext: true,
      async runContextFlushForSession() {
        return {
          ok: false as const,
          reason: 'nothing_to_flush' as const,
        }
      },
    })
    const body = await response.json()

    assert.equal(response.status, 200)
    assert.notEqual(body.session.id, latest.id)
    assert.deepEqual(body.contextFlush, {
      ok: false,
      reason: 'nothing_to_flush',
    })
    assert.equal(sessionRepo.getSession(latest.id)?.status, 'archived')
    assert.equal(sessionRepo.getLatestActiveSessionByAgent('agent-1')?.id, body.session.id)
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('resolveActiveSession does not reset when flushContext is requested for a non-sqlite agent', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-web-active-session-'))
  const dbPath = join(dir, 'test.db')

  try {
    bootstrapDb(dbPath)

    const latest = sessionRepo.createSession('agent-2', 'latest')
    const response = await resolveActiveSession('agent-2', {
      reset: true,
      flushContext: true,
    })

    assert.equal(response.status, 400)
    assert.deepEqual(await response.json(), {
      error: 'Agent memory scheme must be sqlite',
    })
    assert.equal(sessionRepo.getSession(latest.id)?.status, 'active')
    assert.equal(sessionRepo.listSessionsByAgent('agent-2').length, 1)
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('resolveActiveSession does not reset when context flush throws', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-web-active-session-'))
  const dbPath = join(dir, 'test.db')

  try {
    bootstrapDb(dbPath)

    const latest = sessionRepo.createSession('agent-1', 'latest')
    const response = await resolveActiveSession('agent-1', {
      reset: true,
      flushContext: true,
      async runContextFlushForSession() {
        throw new Error('flush exploded')
      },
    })

    assert.equal(response.status, 500)
    assert.deepEqual(await response.json(), {
      error: 'Failed to flush active context',
    })
    assert.equal(sessionRepo.getSession(latest.id)?.status, 'active')
    assert.equal(sessionRepo.listSessionsByAgent('agent-1').filter((session) => session.status === 'active').length, 1)
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})
