import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getDb, getRawSqlite, resetDb } from '@mas/db'
import { createSystems } from '@mas/systems'
import { runAgent, type RunAgentObserver } from './runner'
import type { AgentConfig } from './types'
import type { LLMProvider, LLMRequest, LLMResponse, LLMStreamEvent } from '../provider/types'
import type { Message } from '../types'

class FakeProvider implements LLMProvider {
  name = 'fake'

  constructor(
    private readonly eventsFactory: (params: LLMRequest) => AsyncGenerator<LLMStreamEvent>,
  ) {}

  streamMessage(params: LLMRequest): AsyncGenerator<LLMStreamEvent> {
    return this.eventsFactory(params)
  }

  async sendMessage(params: LLMRequest): Promise<LLMResponse> {
    let response: LLMResponse | undefined
    for await (const event of this.streamMessage(params)) {
      if (event.type === 'message_complete') {
        response = event.response
      }
    }
    if (!response) {
      throw new Error('No response')
    }
    return response
  }
}

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
    CREATE INDEX idx_memories_agent_created_at ON memories(agent_id, created_at);
    CREATE INDEX idx_memories_agent_id ON memories(agent_id);
  `)
  getRawSqlite().exec(`
    INSERT INTO agents (id, name, model) VALUES ('agent-1', 'Agent One', 'claude-sonnet-4-6');
    INSERT INTO sessions (id, agent_id) VALUES ('session-1', 'agent-1');
  `)
}

function createConfig(): AgentConfig {
  return {
    id: 'agent-1',
    sessionId: 'session-1',
    userId: 'user-1',
    model: 'fake-model',
    systemPrompt: 'test',
    tools: [],
    maxTurns: 2,
  }
}

function createTextMessage(role: Message['role'], text: string): Message {
  return {
    role,
    content: [{ type: 'text', text }],
  }
}

test('runAgent records memory retrieval metadata and writes a memory row after turn', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-memory-runner-'))
  const dbPath = join(dir, 'test.db')

  try {
    bootstrapDb(dbPath)
    getRawSqlite().exec(`
      INSERT INTO memories (id, agent_id, session_id, content, summary, tags, importance, created_at)
      VALUES (
        'existing-memory',
        'agent-1',
        'session-1',
        '用户说自己的猫叫橘子',
        '用户养了一只叫橘子的猫',
        '["猫","橘子","宠物"]',
        0.9,
        unixepoch('now') * 1000
      );
    `)

    const observerStarts: Array<{ kind: string }> = []
    const observerEnds: Array<{ metadata?: unknown }> = []
    const observer: RunAgentObserver = {
      onLLMCallStart(payload) {
        observerStarts.push({ kind: payload.kind })
        return `call-${observerStarts.length}`
      },
      onLLMCallEnd(_callId, payload) {
        observerEnds.push({ metadata: payload.metadata })
      },
    }

    const provider = new FakeProvider(async function* (params) {
      if (params.systemPrompt.includes('strict JSON')) {
        yield {
          type: 'message_complete',
          response: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  summary: '用户养了一只叫橘子的猫',
                  tags: ['猫', '橘子', '宠物'],
                  importance: 0.9,
                }),
              },
            ],
            stopReason: 'end_turn',
            usage: { inputTokens: 6, outputTokens: 8 },
          },
        }
        return
      }

      assert.match(params.systemPrompt, /Relevant memories/)
      yield {
        type: 'message_complete',
        response: {
          content: [{ type: 'text', text: '你的猫叫橘子。' }],
          stopReason: 'end_turn',
          usage: { inputTokens: 12, outputTokens: 5 },
        },
      }
    })

    const events = []
    for await (const event of runAgent(
      createConfig(),
      [createTextMessage('user', '我猫叫什么')],
      provider,
      createSystems({
        memory: {
          scheme: 'sqlite',
          summarizeModel: 'memory-model',
          retrieveTopK: 5,
          minTermLength: 2,
        },
      }),
      observer,
    )) {
      events.push(event)
    }

    assert.equal(events.at(-1)?.type, 'complete')
    assert.deepEqual(observerStarts.map((call) => call.kind), ['turn', 'memory'])
    assert.equal(
      ((observerEnds[0]?.metadata as { memory?: { hitCount: number } })?.memory?.hitCount ?? 0),
      1,
    )

    const rows = getRawSqlite()
      .prepare('SELECT summary, tags, importance FROM memories WHERE agent_id = ? ORDER BY rowid')
      .all('agent-1') as Array<{ summary: string; tags: string; importance: number }>
    assert.equal(rows.length, 2)
    assert.deepEqual(JSON.parse(rows[1]!.tags), ['猫', '橘子', '宠物'])
    assert.equal(rows[1]!.summary, '用户养了一只叫橘子的猫')
    assert.equal(rows[1]!.importance, 0.9)
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})
