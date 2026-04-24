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
} from '@mas/db'
import { runContextFlushForSession } from './memory-jobs'

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
                      display_summary: '张三小时候养过一只橘猫',
                      retrieval_text: '张三曾告诉我他小时候养过一只橘猫，我答应过他下次继续聊这件事。',
                      tags: ['张三', '橘猫', '童年', '约定'],
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
    assert.equal(
      seenPrompts[0],
      [
        '待整理的旧上下文：',
        '张三：我小时候养过一只橘猫。',
        '我：记住了，你小时候养过一只橘猫。',
        '张三：下次再提醒我聊这件事。',
        '我：好，我下次会继续聊这件事。',
      ].join('\n'),
    )

    const rows = memoryRepo.listMemoriesByAgentOldestFirst('agent-1')
    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.displaySummary, '张三小时候养过一只橘猫')
    assert.equal(rows[0]?.retrievalText, '张三曾告诉我他小时候养过一只橘猫，我答应过他下次继续聊这件事。')
    assert.match(rows[0]?.sourceText ?? '', /^待整理的旧上下文：\n张三：/)
  } finally {
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})
