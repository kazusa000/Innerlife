import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { LLMProvider } from '@mas/core'
import { getDb, getRawSqlite, memoryRepo, resetDb } from '@mas/db'
import { consolidateSqliteMemories } from './handler'

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
      agent_id TEXT NOT NULL REFERENCES agents(id),
      title TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
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
    CREATE TABLE memories (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id),
      session_id TEXT NOT NULL REFERENCES sessions(id),
      content TEXT NOT NULL,
      summary TEXT NOT NULL,
      tags TEXT NOT NULL,
      importance REAL NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    );
    CREATE TABLE llm_calls (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      user_message_id TEXT NOT NULL REFERENCES messages(id),
      turn_index INTEGER NOT NULL,
      kind TEXT NOT NULL DEFAULT 'turn',
      model TEXT NOT NULL,
      system_prompt TEXT NOT NULL,
      tools_json TEXT NOT NULL,
      messages_json TEXT NOT NULL,
      metadata_json TEXT,
      response_json TEXT,
      stop_reason TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      error TEXT
    );
    CREATE INDEX idx_memories_agent_created_at ON memories(agent_id, created_at);
    CREATE INDEX idx_memories_agent_id ON memories(agent_id);
  `)
  getRawSqlite().exec(`
    INSERT INTO agents (id, name, model, modules)
    VALUES ('agent-1', 'Agent One', 'claude-sonnet-4-6', '{"memory":{"scheme":"sqlite","summarizeModel":"memory-model"}}');
    INSERT INTO agents (id, name, model, modules)
    VALUES ('agent-2', 'Agent Two', 'claude-sonnet-4-6', '{"memory":{"scheme":"noop"}}');
    INSERT INTO sessions (id, agent_id) VALUES ('session-1', 'agent-1');
    INSERT INTO sessions (id, agent_id) VALUES ('session-2', 'agent-1');
    INSERT INTO sessions (id, agent_id) VALUES ('session-3', 'agent-2');
  `)
}

function addAgentOneMemory(input: {
  sessionId: string
  summary: string
  tags: string[]
  importance: number
  createdAt: string
}) {
  return memoryRepo.addMemory({
    agentId: 'agent-1',
    sessionId: input.sessionId,
    content: input.summary,
    summary: input.summary,
    tags: input.tags,
    importance: input.importance,
    createdAt: new Date(input.createdAt),
  })
}

function createProvider(responseText: string): Pick<LLMProvider, 'sendMessage'> {
  return {
    async sendMessage() {
      return {
        content: [{ type: 'text' as const, text: responseText }],
        stopReason: 'end_turn' as const,
        usage: { inputTokens: 12, outputTokens: 8 },
      }
    },
  }
}

test('consolidateSqliteMemories returns 404 when the agent does not exist', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-web-consolidate-'))
  const dbPath = join(dir, 'test.db')

  try {
    bootstrapDb(dbPath)

    const response = await consolidateSqliteMemories('missing-agent', {
      provider: createProvider('{"actions":[]}'),
    })

    assert.equal(response.status, 404)
    assert.deepEqual(await response.json(), { error: 'Not found' })
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('consolidateSqliteMemories returns 400 when the memory scheme is not sqlite', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-web-consolidate-'))
  const dbPath = join(dir, 'test.db')

  try {
    bootstrapDb(dbPath)

    const response = await consolidateSqliteMemories('agent-2', {
      provider: createProvider('{"actions":[]}'),
    })

    assert.equal(response.status, 400)
    assert.deepEqual(await response.json(), { error: 'Agent memory scheme must be sqlite' })
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('consolidateSqliteMemories returns 400 when there are no memories to consolidate', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-web-consolidate-'))
  const dbPath = join(dir, 'test.db')

  try {
    bootstrapDb(dbPath)

    const response = await consolidateSqliteMemories('agent-1', {
      provider: createProvider('{"actions":[]}'),
    })

    assert.equal(response.status, 400)
    assert.deepEqual(await response.json(), { error: 'No memories to consolidate' })
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('consolidateSqliteMemories returns 400 when there are more than 100 memories', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-web-consolidate-'))
  const dbPath = join(dir, 'test.db')

  try {
    bootstrapDb(dbPath)

    for (let index = 0; index < 101; index += 1) {
      addAgentOneMemory({
        sessionId: 'session-1',
        summary: `记忆 ${index + 1}`,
        tags: [`tag-${index + 1}`],
        importance: 0.5,
        createdAt: `2026-04-17T10:${String(index % 60).padStart(2, '0')}:00.000Z`,
      })
    }

    const response = await consolidateSqliteMemories('agent-1', {
      provider: createProvider('{"actions":[]}'),
    })

    assert.equal(response.status, 400)
    assert.deepEqual(await response.json(), { error: 'Too many memories to consolidate at once' })
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('consolidateSqliteMemories returns 500 and leaves memories unchanged when the model output is invalid', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-web-consolidate-'))
  const dbPath = join(dir, 'test.db')

  try {
    bootstrapDb(dbPath)
    addAgentOneMemory({
      sessionId: 'session-1',
      summary: '用户住在布鲁塞尔',
      tags: ['布鲁塞尔', 'brussels'],
      importance: 0.6,
      createdAt: '2026-04-17T10:00:00.000Z',
    })
    addAgentOneMemory({
      sessionId: 'session-2',
      summary: '用户也提到自己住在比利时',
      tags: ['比利时', 'belgium'],
      importance: 0.5,
      createdAt: '2026-04-17T11:00:00.000Z',
    })

    const before = memoryRepo.listMemoriesByAgent('agent-1').map((memory) => ({
      summary: memory.summary,
      tags: memory.tags,
      importance: memory.importance,
    }))
    const response = await consolidateSqliteMemories('agent-1', {
      provider: createProvider('not valid json'),
    })
    const after = memoryRepo.listMemoriesByAgent('agent-1').map((memory) => ({
      summary: memory.summary,
      tags: memory.tags,
      importance: memory.importance,
    }))

    assert.equal(response.status, 500)
    assert.match((await response.json()).error, /JSON|consolidate/i)
    assert.deepEqual(after, before)
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('consolidateSqliteMemories returns a report and emits consolidate observer metadata on success', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-web-consolidate-'))
  const dbPath = join(dir, 'test.db')

  try {
    bootstrapDb(dbPath)
    const keep = addAgentOneMemory({
      sessionId: 'session-1',
      summary: '用户的名字是王杰',
      tags: ['名字', 'name', '王杰'],
      importance: 0.9,
      createdAt: '2026-04-17T10:00:00.000Z',
    })
    const rewrite = addAgentOneMemory({
      sessionId: 'session-1',
      summary: '用户住在布鲁塞尔',
      tags: ['布鲁塞尔'],
      importance: 0.4,
      createdAt: '2026-04-17T11:00:00.000Z',
    })
    const mergeA = addAgentOneMemory({
      sessionId: 'session-1',
      summary: '用户喜欢夜间工作',
      tags: ['夜间', 'night'],
      importance: 0.5,
      createdAt: '2026-04-17T12:00:00.000Z',
    })
    const mergeB = addAgentOneMemory({
      sessionId: 'session-2',
      summary: '用户常在晚上编码',
      tags: ['晚上', 'coding'],
      importance: 0.6,
      createdAt: '2026-04-17T13:00:00.000Z',
    })

    const starts: Array<{ kind: string; systemPrompt: string }> = []
    const ends: Array<{ metadata?: Record<string, unknown> }> = []
    const response = await consolidateSqliteMemories('agent-1', {
      provider: createProvider(JSON.stringify({
        actions: [
          { op: 'keep', id: keep.id },
          {
            op: 'rewrite',
            id: rewrite.id,
            summary: '用户住在比利时布鲁塞尔',
            tags: ['布鲁塞尔', 'brussels', '比利时', 'belgium', '住处', 'location'],
            importance: 0.7,
          },
          {
            op: 'merge',
            sourceIds: [mergeA.id, mergeB.id],
            summary: '用户习惯夜间编码',
            tags: ['夜间', 'night', '编码', 'coding', '晚上', 'evening'],
            importance: 0.8,
          },
        ],
      })),
      resolveObserver() {
        return {
          onLLMCallStart(payload) {
            starts.push({ kind: payload.kind, systemPrompt: payload.systemPrompt })
            return 'call-1'
          },
          onLLMCallEnd(_callId, payload) {
            ends.push({ metadata: payload.metadata })
          },
        }
      },
    })

    const body = await response.json()
    const rows = memoryRepo.listMemoriesByAgent('agent-1')

    assert.equal(response.status, 200)
    assert.deepEqual(body, {
      before: 4,
      after: 3,
      kept: 1,
      rewritten: 1,
      merged: 1,
    })
    assert.equal(starts[0]?.kind, 'memory')
    assert.match(starts[0]?.systemPrompt ?? '', /bilingual/i)
    assert.deepEqual(ends[0]?.metadata, {
      phase: 'consolidate',
      before: 4,
      after: 3,
      kept: 1,
      rewritten: 1,
      merged: 1,
    })
    assert.equal(rows.length, 3)
    assert.ok(rows.some((memory) => memory.summary === '用户习惯夜间编码'))
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})
