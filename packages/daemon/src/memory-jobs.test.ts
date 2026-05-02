import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  getDb,
  getMemoryDb,
  getMemoryRawSqlite,
  getRawSqlite,
  memoryRepo,
  resetDb,
  resetMemoryDb,
  sessionContextStateRepo,
} from '@mas/db'
import { runContextFlushForSession, runSleepForAgent } from './memory-jobs'

function bootstrapDb(dbPath: string, memoryDbPath: string) {
  process.env.MAS_MEMORY_DB_PATH = memoryDbPath
  resetDb()
  resetMemoryDb()
  getDb(dbPath)
  getMemoryDb(memoryDbPath)
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
      agent_id TEXT NOT NULL REFERENCES agents(id),
      title TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    );
    CREATE TABLE relationship_counterparts (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id),
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    );
    CREATE TABLE session_relationship_bindings (
      session_id TEXT PRIMARY KEY REFERENCES sessions(id),
      counterpart_id TEXT NOT NULL REFERENCES relationship_counterparts(id),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    );
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      token_count INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    );
    CREATE TABLE session_context_state (
      session_id TEXT PRIMARY KEY REFERENCES sessions(id),
      active_start_message_id TEXT,
      pending_flush_until_message_id TEXT,
      last_user_message_at INTEGER,
      last_context_flush_at INTEGER,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    );
    CREATE TABLE daemon_events (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      scope TEXT NOT NULL,
      message TEXT NOT NULL,
      payload_json TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    );
    CREATE TABLE agent_memory_sleep_state (
      agent_id TEXT PRIMARY KEY REFERENCES agents(id),
      last_sleep_at INTEGER,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    );
  `)
  getMemoryRawSqlite().exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      layer TEXT NOT NULL DEFAULT 'short_term',
      source_text TEXT NOT NULL,
      display_summary TEXT NOT NULL,
      retrieval_text TEXT NOT NULL,
      retrieval_embedding TEXT NOT NULL,
      retrieval_model TEXT NOT NULL,
      tags TEXT NOT NULL,
      importance REAL NOT NULL,
      observed_start_at INTEGER,
      observed_end_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_memories_agent_created_at ON memories(agent_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_memories_agent_id ON memories(agent_id);
  `)
}

test('runContextFlushForSession uses bound counterpart labels in source text and persisted memories', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-daemon-memory-jobs-'))
  const dbPath = join(dir, 'data.db')
  const memoryDbPath = join(dir, 'memory.db')

  try {
    bootstrapDb(dbPath, memoryDbPath)
    getRawSqlite().exec(`
      INSERT INTO agents (id, name, model, modules, config)
      VALUES (
        'agent-1',
        'Hazel',
        'claude-sonnet-4-6',
        '{"memory":{"scheme":"sqlite","summarizeModel":"memory-model","embeddingModel":"memory-embed"},"relationship":{"scheme":"named-multi-dim"}}',
        '{"provider":"anthropic"}'
      );
      INSERT INTO sessions (id, agent_id, title) VALUES ('session-1', 'agent-1', '张三');
      INSERT INTO relationship_counterparts (id, agent_id, name) VALUES ('cp-zhangsan', 'agent-1', '张三');
      INSERT INTO session_relationship_bindings (session_id, counterpart_id) VALUES ('session-1', 'cp-zhangsan');
      INSERT INTO messages (id, session_id, role, content, created_at) VALUES
        ('m-1', 'session-1', 'user', '[{\"type\":\"text\",\"text\":\"我小时候养过一只橘猫。\"}]', unixepoch('2026-04-23T10:00:00Z') * 1000),
        ('m-2', 'session-1', 'assistant', '[{\"type\":\"text\",\"text\":\"记住了，你小时候养过一只橘猫。\"}]', unixepoch('2026-04-23T10:01:00Z') * 1000),
        ('m-3', 'session-1', 'user', '[{\"type\":\"text\",\"text\":\"下次再提醒我聊这件事。\"}]', unixepoch('2026-04-23T10:02:00Z') * 1000),
        ('m-4', 'session-1', 'assistant', '[{\"type\":\"text\",\"text\":\"好，我下次会继续聊这件事。\"}]', unixepoch('2026-04-23T10:03:00Z') * 1000);
    `)

    const seenPrompts: string[] = []
    const result = await runContextFlushForSession({
      sessionId: 'session-1',
      mode: 'manual',
      provider: {
        async sendMessage(params) {
          const text = typeof params.messages[0]?.content === 'string'
            ? params.messages[0].content
            : Array.isArray(params.messages[0]?.content)
              ? params.messages[0].content
                  .map((block) => block.type === 'text' ? block.text : JSON.stringify(block))
                  .join('\n')
              : ''
          seenPrompts.push(text)
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  memories: [
                    {
                      detail: '张三小时候养过一只橘猫',
                      retrieval_text: '张三曾告诉我他小时候养过一只橘猫，我答应过他下次继续聊这件事。',
                      importance: 0.82,
                    },
                  ],
                }),
              },
            ],
            stopReason: 'end_turn',
            usage: { inputTokens: 10, outputTokens: 10 },
          }
        },
      },
      embedder: {
        async embed(input: string[]) {
          return input.map(() => [1, 0])
        },
      },
    })

    assert.equal(result.ok, true)
    assert.equal(seenPrompts.length, 1)
    assert.match(seenPrompts[0] ?? '', /^待整理的旧上下文：\n整理窗口时间范围：.+ - .+\n/)
    assert.match(seenPrompts[0] ?? '', /张三：\[.+\] 我小时候养过一只橘猫。/)
    assert.match(seenPrompts[0] ?? '', /我：\[.+\] 记住了，你小时候养过一只橘猫。/)
    assert.match(seenPrompts[0] ?? '', /张三：\[.+\] 下次再提醒我聊这件事。/)
    assert.match(seenPrompts[0] ?? '', /我：\[.+\] 好，我下次会继续聊这件事。/)

    const rows = memoryRepo.listMemoriesByAgentOldestFirst('agent-1')
    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.detail, '张三小时候养过一只橘猫')
    assert.equal(rows[0]?.retrievalText, '张三曾告诉我他小时候养过一只橘猫，我答应过他下次继续聊这件事。')
    assert.match(rows[0]?.sourceText ?? '', /^待整理的旧上下文：\n整理窗口时间范围：/)
    assert.match(rows[0]?.sourceText ?? '', /张三：\[.+\] 我小时候养过一只橘猫。/)
    assert.equal(rows[0]?.observedStartAt?.toISOString(), '2026-04-23T10:00:00.000Z')
    assert.equal(rows[0]?.observedEndAt?.toISOString(), '2026-04-23T10:03:00.000Z')
  } finally {
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('runContextFlushForSession idle mode flushes only overflow batch and keeps recent context active', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-daemon-memory-idle-flush-'))
  const dbPath = join(dir, 'data.db')
  const memoryDbPath = join(dir, 'memory.db')

  try {
    bootstrapDb(dbPath, memoryDbPath)
    getRawSqlite().exec(`
      INSERT INTO agents (id, name, model, modules, config)
      VALUES (
        'agent-1',
        'Hazel',
        'claude-sonnet-4-6',
        '{"memory":{"scheme":"sqlite","summarizeModel":"memory-model","embeddingModel":"memory-embed","contextWindowMessages":4,"contextOverflowBatchSize":2,"contextIdleFlushMinutes":10}}',
        '{"provider":"anthropic"}'
      );
      INSERT INTO sessions (id, agent_id, title) VALUES ('session-1', 'agent-1', 'Idle');
      INSERT INTO messages (id, session_id, role, content, created_at) VALUES
        ('m-1', 'session-1', 'user', '[{\"type\":\"text\",\"text\":\"第一轮用户。\"}]', unixepoch('2026-04-23T10:00:00Z') * 1000),
        ('m-2', 'session-1', 'assistant', '[{\"type\":\"text\",\"text\":\"第一轮助手。\"}]', unixepoch('2026-04-23T10:01:00Z') * 1000),
        ('m-3', 'session-1', 'user', '[{\"type\":\"text\",\"text\":\"第二轮用户。\"}]', unixepoch('2026-04-23T10:02:00Z') * 1000),
        ('m-4', 'session-1', 'assistant', '[{\"type\":\"text\",\"text\":\"第二轮助手。\"}]', unixepoch('2026-04-23T10:03:00Z') * 1000),
        ('m-5', 'session-1', 'user', '[{\"type\":\"text\",\"text\":\"第三轮用户。\"}]', unixepoch('2026-04-23T10:04:00Z') * 1000),
        ('m-6', 'session-1', 'assistant', '[{\"type\":\"text\",\"text\":\"第三轮助手。\"}]', unixepoch('2026-04-23T10:05:00Z') * 1000);
    `)

    let sourceText = ''
    const result = await runContextFlushForSession({
      sessionId: 'session-1',
      mode: 'idle',
      now: new Date('2026-04-23T10:30:00.000Z'),
      provider: {
        async sendMessage(params) {
          sourceText = Array.isArray(params.messages[0]?.content)
            ? params.messages[0].content
                .map((block) => block.type === 'text' ? block.text : '')
                .join('\n')
            : ''
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  memories: [
                    {
                      detail: '第一轮对话',
                      retrieval_text: '第一轮用户和助手说过话。',
                      importance: 0.6,
                    },
                  ],
                }),
              },
            ],
            stopReason: 'end_turn',
            usage: { inputTokens: 10, outputTokens: 10 },
          }
        },
      },
      embedder: {
        async embed(input: string[]) {
          return input.map(() => [1, 0])
        },
      },
    })

    assert.equal(result.ok, true)
    assert.equal(result.flushedMessageCount, 2)
    assert.equal(result.nextActiveStartMessageId, 'm-3')
    assert.match(sourceText, /第一轮用户/)
    assert.match(sourceText, /第一轮助手/)
    assert.doesNotMatch(sourceText, /第二轮用户/)
    assert.doesNotMatch(sourceText, /第三轮用户/)
    assert.equal(
      sessionContextStateRepo.getSessionContextState('session-1')?.activeStartMessageId,
      'm-3',
    )
  } finally {
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('runSleepForAgent creates long-term memories from referenced short-term ids only', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-daemon-memory-sleep-'))
  const dbPath = join(dir, 'data.db')
  const memoryDbPath = join(dir, 'memory.db')

  try {
    bootstrapDb(dbPath, memoryDbPath)
    getRawSqlite().exec(`
      INSERT INTO agents (id, name, model, modules, config)
      VALUES (
        'agent-1',
        'Hazel',
        'claude-sonnet-4-6',
        '{"memory":{"scheme":"sqlite","summarizeModel":"memory-model","embeddingModel":"memory-embed"}}',
        '{"provider":"anthropic"}'
      );
      INSERT INTO sessions (id, agent_id, title) VALUES ('session-1', 'agent-1', 'Sleep');
    `)

    const catMorning = memoryRepo.addMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      layer: 'short_term',
      sourceText: 'source cat morning',
      detail: '张三提到小时候养过橘猫',
      retrievalText: '张三小时候养过一只橘猫。',
      retrievalEmbedding: [1, 0],
      retrievalModel: 'memory-embed',
      tags: ['猫'],
      importance: 0.7,
      observedStartAt: new Date('2026-04-23T10:07:00.000Z'),
      observedEndAt: new Date('2026-04-23T10:10:00.000Z'),
      createdAt: new Date('2026-04-23T10:15:00.000Z'),
    })
    const coffee = memoryRepo.addMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      layer: 'short_term',
      sourceText: 'source coffee',
      detail: '张三提到喜欢浅烘咖啡',
      retrievalText: '张三喜欢浅烘咖啡。',
      retrievalEmbedding: [0, 1],
      retrievalModel: 'memory-embed',
      tags: ['咖啡'],
      importance: 0.6,
      observedStartAt: new Date('2026-04-23T11:00:00.000Z'),
      observedEndAt: new Date('2026-04-23T11:05:00.000Z'),
      createdAt: new Date('2026-04-23T11:10:00.000Z'),
    })
    const catNoon = memoryRepo.addMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      layer: 'short_term',
      sourceText: 'source cat noon',
      detail: '张三纠正猫的名字叫年糕',
      retrievalText: '张三纠正那只猫叫年糕。',
      retrievalEmbedding: [1, 1],
      retrievalModel: 'memory-embed',
      tags: ['猫'],
      importance: 0.8,
      observedStartAt: new Date('2026-04-23T12:03:00.000Z'),
      observedEndAt: new Date('2026-04-23T12:05:00.000Z'),
      createdAt: new Date('2026-04-23T12:10:00.000Z'),
    })

    const result = await runSleepForAgent({
      agentId: 'agent-1',
      mode: 'manual',
      now: new Date('2026-04-24T03:00:00.000Z'),
      provider: {
        async sendMessage() {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  memories: [
                    {
                      detail: '张三小时候养过一只橘猫',
                      retrieval_text: '张三告诉过我他小时候养过一只橘猫。',
                      importance: 0.78,
                      source_stm_ids: [catMorning.id],
                    },
                    {
                      detail: '张三纠正那只猫叫年糕',
                      retrieval_text: '张三后来纠正那只猫的名字叫年糕。',
                      importance: 0.86,
                      source_stm_ids: [catNoon.id],
                    },
                  ],
                }),
              },
            ],
            stopReason: 'end_turn',
            usage: { inputTokens: 10, outputTokens: 10 },
          }
        },
      },
      embedder: {
        async embed(input: string[]) {
          return input.map(() => [1, 0])
        },
      },
    })

    assert.equal(result.ok, true)
    assert.equal(result.createdCount, 2)
    assert.equal(result.deletedShortTermCount, 2)
    assert.equal(result.retainedShortTermCount, 1)

    const rows = memoryRepo.listMemoriesByAgentOldestFirst('agent-1')
    const remainingShortTerm = rows.filter((memory) => memory.layer === 'short_term')
    const longTerm = rows.filter((memory) => memory.layer === 'long_term')

    assert.deepEqual(remainingShortTerm.map((memory) => memory.id), [coffee.id])
    assert.equal(longTerm.length, 2)
    assert.deepEqual(longTerm.map((memory) => memory.tags), [[], []])
    assert.equal(longTerm[0]?.observedStartAt?.toISOString(), '2026-04-23T10:00:00.000Z')
    assert.equal(longTerm[0]?.observedEndAt?.toISOString(), '2026-04-23T10:59:59.999Z')
    assert.equal(longTerm[1]?.observedStartAt?.toISOString(), '2026-04-23T12:00:00.000Z')
    assert.equal(longTerm[1]?.observedEndAt?.toISOString(), '2026-04-23T12:59:59.999Z')
    assert.match(longTerm[0]?.sourceText ?? '', new RegExp(catMorning.id))
    assert.doesNotMatch(longTerm[0]?.sourceText ?? '', new RegExp(coffee.id))
    assert.match(longTerm[1]?.sourceText ?? '', new RegExp(catNoon.id))
    assert.doesNotMatch(longTerm[1]?.sourceText ?? '', new RegExp(coffee.id))
  } finally {
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})
