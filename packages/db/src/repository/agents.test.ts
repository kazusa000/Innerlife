import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getDb, getRawSqlite, resetDb } from '../client'
import { createAgent, getAgent, updateAgent } from './agents'

test('createAgent and updateAgent migrate top-level prompts into modules.personality', () => {
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

    assert.deepEqual(created.modules, {
      personality: {
        systemPrompt: '你是一个真实存在的人，不要自称 AI。',
        personaPrompt: '回答时像熟人，少一点客服感。',
      },
    })
    assert.equal(created.provider, 'openrouter')
    assert.equal(created.systemPrompt, '你是一个真实存在的人，不要自称 AI。')
    assert.equal(created.personaPrompt, '回答时像熟人，少一点客服感。')

    const modules = {
      safety: { mode: 'confirm-dangerous' },
    }

    const updated = updateAgent(created.id, {
      modules,
      systemPrompt: '保持自然、克制，不要像助手。',
      personaPrompt: '像朋友，不要把话说太满。',
    })
    assert.deepEqual(updated?.modules, {
      personality: {
        systemPrompt: '保持自然、克制，不要像助手。',
        personaPrompt: '像朋友，不要把话说太满。',
      },
      safety: { mode: 'confirm-dangerous' },
    })
    assert.equal(updated?.systemPrompt, '保持自然、克制，不要像助手。')
    assert.equal(updated?.personaPrompt, '像朋友，不要把话说太满。')

    const loaded = getAgent(created.id)
    assert.deepEqual(loaded?.modules, {
      personality: {
        systemPrompt: '保持自然、克制，不要像助手。',
        personaPrompt: '像朋友，不要把话说太满。',
      },
      safety: { mode: 'confirm-dangerous' },
    })
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

test('createAgent and updateAgent round-trip persona avatarUrl in modules.personality', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-agents-avatar-'))
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
      name: 'Avatar Test',
      model: 'claude-sonnet-4-6',
      systemPrompt: '保持真实。',
      avatarUrl: 'https://example.com/avatar.png',
    })

    assert.equal(created.avatarUrl, 'https://example.com/avatar.png')
    assert.deepEqual(created.modules, {
      personality: {
        systemPrompt: '保持真实。',
        avatarUrl: 'https://example.com/avatar.png',
      },
    })

    const promptOnlyUpdate = updateAgent(created.id, {
      personaPrompt: '像熟人一样聊天。',
    })
    assert.equal(promptOnlyUpdate?.avatarUrl, 'https://example.com/avatar.png')
    assert.deepEqual(promptOnlyUpdate?.modules?.personality, {
      systemPrompt: '保持真实。',
      personaPrompt: '像熟人一样聊天。',
      avatarUrl: 'https://example.com/avatar.png',
    })

    const cleared = updateAgent(created.id, { avatarUrl: '' })
    assert.equal(cleared?.avatarUrl, '')
    assert.deepEqual(cleared?.modules?.personality, {
      systemPrompt: '保持真实。',
      personaPrompt: '像熟人一样聊天。',
    })
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('createAgent and updateAgent round-trip top-level tools config', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-agents-tools-'))
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
      name: 'Tools Test',
      model: 'claude-sonnet-4-6',
      tools: {
        search_long_term_memory: {
          description: '只在需要追溯旧互动时再查长期记忆。',
        },
      },
    })

    assert.deepEqual(created.tools, {
      search_long_term_memory: {
        description: '只在需要追溯旧互动时再查长期记忆。',
      },
    })

    const updated = updateAgent(created.id, {
      tools: {
        search_long_term_memory: {
          enabled: false,
          description: '手动关闭长期记忆检索。',
        },
        web_fetch: {
          enabled: true,
          description: '抓取网页正文，不要保留无关导航信息。',
        },
      },
    })

    assert.deepEqual(updated?.tools, {
      search_long_term_memory: {
        enabled: false,
        description: '手动关闭长期记忆检索。',
      },
      web_fetch: {
        enabled: true,
        description: '抓取网页正文，不要保留无关导航信息。',
      },
    })
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('createAgent and updateAgent preserve openai-compatible provider', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-agents-provider-'))
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
      name: 'Provider Test',
      provider: 'openai-compatible',
      model: 'gpt-4.1-mini',
    })

    assert.equal(created.provider, 'openai-compatible')

    const switched = updateAgent(created.id, {
      provider: 'openrouter',
      model: 'anthropic/claude-sonnet-4.6',
    })
    assert.equal(switched?.provider, 'openrouter')

    const restored = updateAgent(created.id, {
      provider: 'openai-compatible',
      model: 'gpt-4.1-mini',
    })
    assert.equal(restored?.provider, 'openai-compatible')
    assert.equal(getAgent(created.id)?.provider, 'openai-compatible')
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('getAgent migrates config prompts into modules.personality and ignores legacy personality.prompt fallback', () => {
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
        '{"personality":{"scheme":"big-five","prompt":"像熟人，不要客服腔。"},"emotion":{"scheme":"dimensional"}}',
        '{"provider":"anthropic","systemPrompt":"不要自称 AI。","personaPrompt":"像朋友，简短一点。"}',
      )

    const loaded = getAgent('legacy-agent')
    assert.equal(loaded?.systemPrompt, '不要自称 AI。')
    assert.equal(loaded?.personaPrompt, '像朋友，简短一点。')
    assert.deepEqual(loaded?.modules, {
      personality: {
        systemPrompt: '不要自称 AI。',
        personaPrompt: '像朋友，简短一点。',
      },
      emotion: {
        scheme: 'dimensional',
      },
    })
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})
