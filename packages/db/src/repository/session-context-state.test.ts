import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getDb, getRawSqlite, resetDb } from '../client'
import {
  deleteSessionContextState,
  getSessionContextState,
  recordContextFlush,
  recordUserContextActivity,
  upsertSessionContextState,
} from './session-context-state'

function bootstrapDb(dbPath: string) {
  resetDb()
  getDb(dbPath)
  getRawSqlite().exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      title TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    );
    CREATE TABLE session_context_state (
      session_id TEXT PRIMARY KEY REFERENCES sessions(id),
      active_start_message_id TEXT,
      pending_flush_until_message_id TEXT,
      last_user_message_at INTEGER,
      last_context_flush_at INTEGER,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    );
    INSERT INTO sessions (id, agent_id) VALUES ('session-1', 'agent-1');
  `)
}

test('session context state stores active boundary and flush metadata', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-session-context-state-'))
  const dbPath = join(dir, 'data.db')

  try {
    bootstrapDb(dbPath)

    const initial = upsertSessionContextState({
      sessionId: 'session-1',
      activeStartMessageId: 'message-42',
      pendingFlushUntilMessageId: 'message-18',
      lastUserMessageAt: new Date('2026-04-22T10:00:00Z'),
      lastContextFlushAt: null,
    })

    assert.equal(initial.sessionId, 'session-1')
    assert.equal(initial.activeStartMessageId, 'message-42')
    assert.equal(initial.pendingFlushUntilMessageId, 'message-18')
    assert.equal(initial.lastUserMessageAt?.toISOString(), '2026-04-22T10:00:00.000Z')
    assert.equal(initial.lastContextFlushAt, null)

    const updated = recordContextFlush({
      sessionId: 'session-1',
      nextActiveStartMessageId: 'message-65',
      pendingFlushUntilMessageId: null,
      at: new Date('2026-04-22T11:00:00Z'),
    })

    assert.equal(updated.activeStartMessageId, 'message-65')
    assert.equal(updated.pendingFlushUntilMessageId, null)
    assert.equal(updated.lastContextFlushAt?.toISOString(), '2026-04-22T11:00:00.000Z')
    assert.equal(updated.lastUserMessageAt?.toISOString(), '2026-04-22T10:00:00.000Z')

    deleteSessionContextState('session-1')
    assert.equal(getSessionContextState('session-1'), undefined)
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('recordUserContextActivity seeds an empty context and preserves existing active start', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-session-context-state-'))
  const dbPath = join(dir, 'data.db')

  try {
    bootstrapDb(dbPath)

    const first = recordUserContextActivity({
      sessionId: 'session-1',
      userMessageId: 'message-1',
      at: new Date('2026-04-22T12:00:00Z'),
    })
    assert.equal(first.activeStartMessageId, 'message-1')
    assert.equal(first.lastUserMessageAt?.toISOString(), '2026-04-22T12:00:00.000Z')

    const second = recordUserContextActivity({
      sessionId: 'session-1',
      userMessageId: 'message-2',
      at: new Date('2026-04-22T12:05:00Z'),
    })
    assert.equal(second.activeStartMessageId, 'message-1')
    assert.equal(second.lastUserMessageAt?.toISOString(), '2026-04-22T12:05:00.000Z')

    recordContextFlush({
      sessionId: 'session-1',
      nextActiveStartMessageId: null,
      at: new Date('2026-04-22T12:10:00Z'),
    })

    const afterEmpty = recordUserContextActivity({
      sessionId: 'session-1',
      userMessageId: 'message-3',
      at: new Date('2026-04-22T12:15:00Z'),
    })
    assert.equal(afterEmpty.activeStartMessageId, 'message-3')
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})
