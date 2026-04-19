import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getDb, getRawSqlite, resetDb } from '@mas/db'
import { createSystems, type AgentSystem } from '@mas/systems'
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
      if (params.systemPrompt.includes('retrieval keywords')) {
        yield {
          type: 'message_complete',
          response: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  keywords: ['猫', '我猫叫什么'],
                }),
              },
            ],
            stopReason: 'end_turn',
            usage: { inputTokens: 5, outputTokens: 4 },
          },
        }
        return
      }

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
    assert.deepEqual(observerStarts.map((call) => call.kind), ['memory', 'turn', 'memory'])
    assert.deepEqual(observerEnds[0]?.metadata, {
      phase: 'retrieve',
      source: 'llm',
      fallbackKeywords: ['猫', '我猫叫什么'],
      keywords: ['猫', '我猫叫什么'],
      hitCount: 1,
      memoryIds: ['existing-memory'],
      hits: [
        {
          id: 'existing-memory',
          summary: '用户养了一只叫橘子的猫',
          tags: ['猫', '橘子', '宠物'],
          importance: 0.9,
          matchedTerms: ['猫'],
        },
      ],
    })
    assert.equal(
      ((observerEnds[1]?.metadata as { memory?: { hitCount: number } })?.memory?.hitCount ?? 0),
      1,
    )
    const rows = getRawSqlite()
      .prepare('SELECT id, summary, tags, importance FROM memories WHERE agent_id = ? ORDER BY rowid')
      .all('agent-1') as Array<{ id: string; summary: string; tags: string; importance: number }>
    assert.equal(rows.length, 2)
    assert.deepEqual(observerEnds[2]?.metadata, {
      phase: 'summarize',
      written: {
        id: rows[1]!.id,
        summary: '用户养了一只叫橘子的猫',
        tags: ['猫', '橘子', '宠物'],
        importance: 0.9,
      },
    })
    assert.deepEqual(JSON.parse(rows[1]!.tags), ['猫', '橘子', '宠物'])
    assert.equal(rows[1]!.summary, '用户养了一只叫橘子的猫')
    assert.equal(rows[1]!.importance, 0.9)
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('runAgent uses LLM-expanded memory keywords instead of tokenizer results', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-memory-query-llm-'))
  const dbPath = join(dir, 'test.db')

  try {
    bootstrapDb(dbPath)
    getRawSqlite().exec(`
      INSERT INTO memories (id, agent_id, session_id, content, summary, tags, importance, created_at)
      VALUES (
        'name-memory',
        'agent-1',
        'session-1',
        '用户说自己的名字是王家骏',
        '用户名字叫王家骏',
        '["名字","name"]',
        0.9,
        unixepoch('now') * 1000
      );
    `)

    const observerStarts: Array<{ kind: string }> = []
    const observerEnds: Array<{ metadata?: unknown; error?: string }> = []
    const observer: RunAgentObserver = {
      onLLMCallStart(payload) {
        observerStarts.push({ kind: payload.kind })
        return `call-${observerStarts.length}`
      },
      onLLMCallEnd(_callId, payload) {
        observerEnds.push({ metadata: payload.metadata, error: payload.error })
      },
    }

    const provider = new FakeProvider(async function* (params) {
      if (params.systemPrompt.includes('retrieval keywords')) {
        yield {
          type: 'message_complete',
          response: {
            content: [{ type: 'text', text: JSON.stringify({ keywords: ['name', '名字'] }) }],
            stopReason: 'end_turn',
            usage: { inputTokens: 4, outputTokens: 5 },
          },
        }
        return
      }

      if (params.systemPrompt.includes('strict JSON')) {
        yield {
          type: 'message_complete',
          response: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  summary: '用户名字叫王家骏',
                  tags: ['名字', 'name'],
                  importance: 0.95,
                }),
              },
            ],
            stopReason: 'end_turn',
            usage: { inputTokens: 4, outputTokens: 6 },
          },
        }
        return
      }

      assert.match(params.systemPrompt, /Relevant memories/)
      yield {
        type: 'message_complete',
        response: {
          content: [{ type: 'text', text: '你叫王家骏。' }],
          stopReason: 'end_turn',
          usage: { inputTokens: 8, outputTokens: 4 },
        },
      }
    })

    const events = []
    for await (const event of runAgent(
      createConfig(),
      [createTextMessage('user', `what's my name`)],
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
    assert.deepEqual(observerStarts.map((call) => call.kind), ['memory', 'turn', 'memory'])
    assert.deepEqual(observerEnds[0]?.metadata, {
      phase: 'retrieve',
      source: 'llm',
      fallbackKeywords: ['name'],
      keywords: ['name', '名字'],
      hitCount: 1,
      memoryIds: ['name-memory'],
      hits: [
        {
          id: 'name-memory',
          summary: '用户名字叫王家骏',
          tags: ['名字', 'name'],
          importance: 0.9,
          matchedTerms: ['name', '名字'],
        },
      ],
    })
    assert.equal(
      ((observerEnds[1]?.metadata as { memory?: { keywords?: string[] } })?.memory?.keywords ?? [])[0],
      'name',
    )
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('runAgent falls back to tokenizer keywords and emits system_error when memory query call throws', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-memory-query-fallback-'))
  const dbPath = join(dir, 'test.db')

  try {
    bootstrapDb(dbPath)
    getRawSqlite().exec(`
      INSERT INTO memories (id, agent_id, session_id, content, summary, tags, importance, created_at)
      VALUES (
        'fallback-memory',
        'agent-1',
        'session-1',
        '用户说自己的猫叫橘子',
        '用户养了一只叫橘子的猫',
        '["猫","pet"]',
        0.9,
        unixepoch('now') * 1000
      );
    `)

    const observerEnds: Array<{ metadata?: unknown; error?: string }> = []
    const observer: RunAgentObserver = {
      onLLMCallStart() {
        return 'call-1'
      },
      onLLMCallEnd(_callId, payload) {
        observerEnds.push({ metadata: payload.metadata, error: payload.error })
      },
    }

    const provider = new FakeProvider(async function* (params) {
      if (params.systemPrompt.includes('retrieval keywords')) {
        throw new Error('memory query failed')
      }

      if (params.systemPrompt.includes('strict JSON')) {
        yield {
          type: 'message_complete',
          response: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  summary: '用户养了一只叫橘子的猫',
                  tags: ['猫', 'pet'],
                  importance: 0.8,
                }),
              },
            ],
            stopReason: 'end_turn',
            usage: { inputTokens: 4, outputTokens: 6 },
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
          usage: { inputTokens: 7, outputTokens: 4 },
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
      events.push(
        event.type === 'system_error'
          ? { type: 'system_error', system: event.system, phase: event.phase, error: event.error.message }
          : event,
      )
    }

    assert.deepEqual(events[0], {
      type: 'system_error',
      system: 'memory:sqlite',
      phase: 'beforeTurn',
      error: 'memory query failed',
    })
    assert.equal(events.at(-1)?.type, 'complete')
    assert.deepEqual(observerEnds[0]?.metadata, {
      phase: 'retrieve',
      source: 'fallback',
      fallbackKeywords: ['猫', '我猫叫什么'],
      keywords: ['猫', '我猫叫什么'],
      hitCount: 1,
      memoryIds: ['fallback-memory'],
      hits: [
        {
          id: 'fallback-memory',
          summary: '用户养了一只叫橘子的猫',
          tags: ['猫', 'pet'],
          importance: 0.9,
          matchedTerms: ['猫'],
        },
      ],
    })
    assert.equal(observerEnds[0]?.error, 'memory query failed')
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('runAgent emits system_error and continues when memory retrieval throws', async () => {
  const observerEnds: Array<{ metadata?: unknown; error?: string }> = []
  const observer: RunAgentObserver = {
    onLLMCallStart() {
      return `call-${observerEnds.length + 1}`
    },
    onLLMCallEnd(_callId, payload) {
      observerEnds.push({ metadata: payload.metadata, error: payload.error })
    },
  }
  const systems: AgentSystem[] = [
    {
      name: 'memory:sqlite',
      type: 'memory',
      async beforeTurn(ctx) {
        ctx.pendingMemoryQuery = {
          kind: 'sqlite',
          system: 'memory:sqlite',
          prompt: 'memory retrieval keywords',
          inputText: ctx.input.text,
          fallback: ['cat'],
          parse() {
            return ['cat']
          },
          retrieve() {
            throw new Error('memory retrieve failed')
          },
        }
      },
    },
  ]
  const provider = new FakeProvider(async function* (params) {
    if (params.systemPrompt === 'memory retrieval keywords') {
      yield {
        type: 'message_complete',
        response: {
          content: [{ type: 'text', text: JSON.stringify({ keywords: ['cat'] }) }],
          stopReason: 'end_turn',
          usage: { inputTokens: 4, outputTokens: 4 },
        },
      }
      return
    }

    assert.equal(params.systemPrompt, 'test')
    yield {
      type: 'message_complete',
      response: {
        content: [{ type: 'text', text: 'still completes' }],
        stopReason: 'end_turn',
        usage: { inputTokens: 6, outputTokens: 2 },
      },
    }
  })

  const events = []
  for await (const event of runAgent(
    createConfig(),
    [createTextMessage('user', 'what did I say about my cat?')],
    provider,
    systems,
    observer,
  )) {
    events.push(
      event.type === 'system_error'
        ? { type: 'system_error', system: event.system, phase: event.phase, error: event.error.message }
        : event,
    )
  }

  assert.deepEqual(events[0], {
    type: 'system_error',
    system: 'memory:sqlite',
    phase: 'beforeTurn',
    error: 'memory retrieve failed',
  })
  assert.equal(events.at(-1)?.type, 'complete')
  assert.deepEqual(observerEnds[0]?.metadata, {
    phase: 'retrieve',
    source: 'llm',
    fallbackKeywords: ['cat'],
    keywords: ['cat'],
  })
  assert.equal(observerEnds[0]?.error, 'memory retrieve failed')
})

test('runAgent falls back to tokenizer keywords when memory query returns invalid JSON or empty keywords', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-memory-query-invalid-'))
  const dbPath = join(dir, 'test.db')

  try {
    bootstrapDb(dbPath)
    getRawSqlite().exec(`
      INSERT INTO memories (id, agent_id, session_id, content, summary, tags, importance, created_at)
      VALUES (
        'invalid-memory',
        'agent-1',
        'session-1',
        '用户说自己的猫叫橘子',
        '用户养了一只叫橘子的猫',
        '["猫","pet"]',
        0.9,
        unixepoch('now') * 1000
      );
    `)

    const observerEnds: Array<{ metadata?: unknown; error?: string }> = []
    const observer: RunAgentObserver = {
      onLLMCallStart() {
        return `call-${observerEnds.length + 1}`
      },
      onLLMCallEnd(_callId, payload) {
        observerEnds.push({ metadata: payload.metadata, error: payload.error })
      },
    }

    let queryCalls = 0
    const provider = new FakeProvider(async function* (params) {
      if (params.systemPrompt.includes('retrieval keywords')) {
        queryCalls += 1
        yield {
          type: 'message_complete',
          response: {
            content: [
              {
                type: 'text',
                text: queryCalls === 1 ? '{not json' : JSON.stringify({ keywords: [] }),
              },
            ],
            stopReason: 'end_turn',
            usage: { inputTokens: 4, outputTokens: 3 },
          },
        }
        return
      }

      if (params.systemPrompt.includes('strict JSON')) {
        yield {
          type: 'message_complete',
          response: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  summary: '用户养了一只叫橘子的猫',
                  tags: ['猫', 'pet'],
                  importance: 0.8,
                }),
              },
            ],
            stopReason: 'end_turn',
            usage: { inputTokens: 4, outputTokens: 6 },
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
          usage: { inputTokens: 7, outputTokens: 4 },
        },
      }
    })

    for (const input of ['我猫叫什么', '我猫叫什么']) {
      const events = []
      for await (const event of runAgent(
        createConfig(),
        [createTextMessage('user', input)],
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
        events.push(
          event.type === 'system_error'
            ? { type: 'system_error', system: event.system, phase: event.phase, error: event.error.message }
            : event,
        )
      }

      assert.equal(events.at(-1)?.type, 'complete')
      assert.deepEqual(events[0], {
        type: 'system_error',
        system: 'memory:sqlite',
        phase: 'beforeTurn',
        error: queryCalls === 1
          ? 'Memory query call returned invalid JSON'
          : 'Memory query call returned no keywords',
      })
    }

    assert.deepEqual(observerEnds[0]?.metadata, {
      phase: 'retrieve',
      source: 'fallback',
      fallbackKeywords: ['猫', '我猫叫什么'],
      keywords: ['猫', '我猫叫什么'],
      hitCount: 1,
      memoryIds: ['invalid-memory'],
      hits: [
        {
          id: 'invalid-memory',
          summary: '用户养了一只叫橘子的猫',
          tags: ['猫', 'pet'],
          importance: 0.9,
          matchedTerms: ['猫'],
        },
      ],
    })
    assert.equal((observerEnds[3]?.metadata as { phase?: string })?.phase, 'retrieve')
    assert.equal((observerEnds[3]?.metadata as { source?: string })?.source, 'fallback')
    assert.deepEqual(
      (observerEnds[3]?.metadata as { fallbackKeywords?: string[] })?.fallbackKeywords,
      ['猫', '我猫叫什么'],
    )
    assert.deepEqual(
      (observerEnds[3]?.metadata as { keywords?: string[] })?.keywords,
      ['猫', '我猫叫什么'],
    )
    assert.equal((observerEnds[3]?.metadata as { hitCount?: number })?.hitCount, 2)
    assert.deepEqual(
      ((observerEnds[3]?.metadata as { memoryIds?: string[] })?.memoryIds ?? []).includes('invalid-memory'),
      true,
    )
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})
