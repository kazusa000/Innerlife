import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getDb, getRawSqlite, resetDb } from '../client'
import { createAgent, getAgent, updateAgent } from './agents'

test('createAgent and updateAgent round-trip nullable modules JSON and provider config', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-agents-'))
  const dbPath = join(dir, 'test.db')

  try {
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
    `)

    const created = createAgent({
      name: 'Modules Test',
      description: 'repo test',
      provider: 'openrouter',
      model: 'claude-sonnet-4-6',
      systemPrompt: '你是一个真实存在的人，不要自称 AI。',
      personaPrompt: '回答时像熟人，少一点客服感。',
    })

    assert.equal(created.modules, null)
    assert.equal(created.provider, 'openrouter')
    assert.equal(created.systemPrompt, '你是一个真实存在的人，不要自称 AI。')
    assert.equal(created.personaPrompt, '回答时像熟人，少一点客服感。')

    const modules = {
      personality: { type: 'big-five' },
      safety: { mode: 'confirm-dangerous' },
    }

    const updated = updateAgent(created.id, {
      modules,
      systemPrompt: '保持自然、克制，不要像助手。',
      personaPrompt: '像朋友，不要把话说太满。',
    })
    assert.deepEqual(updated?.modules, modules)
    assert.equal(updated?.systemPrompt, '保持自然、克制，不要像助手。')
    assert.equal(updated?.personaPrompt, '像朋友，不要把话说太满。')

    const loaded = getAgent(created.id)
    assert.deepEqual(loaded?.modules, modules)
    assert.equal(loaded?.provider, 'openrouter')
    assert.equal(loaded?.systemPrompt, '保持自然、克制，不要像助手。')
    assert.equal(loaded?.personaPrompt, '像朋友，不要把话说太满。')

    const switched = updateAgent(created.id, { provider: 'anthropic' })
    assert.equal(switched?.provider, 'anthropic')
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('getAgent falls back to legacy personality prompt as personaPrompt when top-level field is absent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-agents-'))
  const dbPath = join(dir, 'test.db')

  try {
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
    `)

    getRawSqlite()
      .prepare(`
        INSERT INTO agents (id, name, model, modules, config)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(
        'legacy-agent',
        'Legacy',
        'claude-sonnet-4-6',
        '{"personality":{"scheme":"big-five","prompt":"像熟人，不要客服腔。"}}',
        '{"provider":"anthropic"}',
      )

    const loaded = getAgent('legacy-agent')
    assert.equal(loaded?.personaPrompt, '像熟人，不要客服腔。')
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})
