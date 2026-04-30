import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  getDb,
  getMemoryDb,
  getRawSqlite,
  episodicMemoryGraphRepo,
  memoryRepo,
  resetDb,
  resetMemoryDb,
} from '@mas/db'
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
      token_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    );
    CREATE TABLE tool_executions (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL REFERENCES messages(id),
      tool_name TEXT NOT NULL,
      input TEXT NOT NULL,
      output TEXT NOT NULL,
      is_error INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL DEFAULT 0,
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

function isMemorySemanticPrompt(systemPrompt: string): boolean {
  return systemPrompt.includes('sqlite 记忆系统的语义分析器')
}

function createEmbedder(map: Record<string, number[]>) {
  return {
    async embed(input: string[]) {
      return input.map((item) => map[item] ?? [0, 0])
    },
  }
}

function createTimeParser(map: Record<string, { start: string; end: string } | null>) {
  return (input: string) => {
    const range = map[input]
    return {
      timeRange: range
        ? {
            start: new Date(range.start),
            end: new Date(range.end),
          }
        : null,
    }
  }
}

test('runAgent uses bound named counterpart labels in the memory semantic analyzer input', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-memory-runner-'))
  const dbPath = join(dir, 'data.db')
  const memoryDbPath = join(dir, 'memory.db')

  try {
    bootstrapDb(dbPath, memoryDbPath)
    getRawSqlite().exec(`
      UPDATE agents
      SET modules = '{"relationship":{"scheme":"named-multi-dim"}}'
      WHERE id = 'agent-1';
      INSERT INTO relationship_counterparts (id, agent_id, name) VALUES ('cp-zhangsan', 'agent-1', '张三');
      INSERT INTO session_relationship_bindings (session_id, counterpart_id) VALUES ('session-1', 'cp-zhangsan');
    `)

    let sawSemanticCall = false
    const provider = new FakeProvider(async function* (params) {
      if (isMemorySemanticPrompt(params.systemPrompt)) {
        sawSemanticCall = true
        assert.deepEqual(params.messages, [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: [
                  '最近对话（仅供补全当前问题）：',
                  '张三：我上周收养了一只猫。',
                  '我：记住了，你上周收养了一只猫。',
                  '张三：我给它起名叫橘子。',
                  '我：好的，我记住那只猫叫橘子。',
                  '',
                  '当前消息（来自张三）：',
                  '我猫叫什么',
                ].join('\n'),
              },
            ],
          },
        ])
        yield {
          type: 'message_complete',
          response: {
            content: [{ type: 'text', text: JSON.stringify({ retrieval_query: '张三那只猫叫什么名字' }) }],
            stopReason: 'end_turn',
            usage: { inputTokens: 5, outputTokens: 4 },
          },
        }
        return
      }

      yield {
        type: 'message_complete',
        response: {
          content: [{ type: 'text', text: 'answer' }],
          stopReason: 'end_turn',
          usage: { inputTokens: 5, outputTokens: 4 },
        },
      }
    })

    const systems = createSystems({
      memory: {
        scheme: 'sqlite',
        embedder: createEmbedder({
          我猫叫什么: [1, 0],
          张三那只猫叫什么名字: [1, 0],
        }),
      },
    })

    const events: string[] = []
    for await (const event of runAgent(
      createConfig(),
      [
        createTextMessage('user', '我上周收养了一只猫。'),
        createTextMessage('assistant', '记住了，你上周收养了一只猫。'),
        createTextMessage('user', '我给它起名叫橘子。'),
        createTextMessage('assistant', '好的，我记住那只猫叫橘子。'),
        createTextMessage('user', '我猫叫什么'),
      ],
      provider,
      systems,
    )) {
      events.push(event.type)
    }

    assert.equal(sawSemanticCall, true)
    assert.ok(events.includes('complete'))
  } finally {
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('runAgent records embedding retrieval metadata without writing a short-term row after every turn', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-memory-runner-'))
  const dbPath = join(dir, 'data.db')
  const memoryDbPath = join(dir, 'memory.db')

  try {
    bootstrapDb(dbPath, memoryDbPath)
    const existingMemory = memoryRepo.addMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      sourceText: '用户说自己的猫叫橘子',
      displaySummary: '用户养了一只叫橘子的猫',
      retrievalText: '用户曾告诉我，他养了一只名叫橘子的猫',
      retrievalEmbedding: [1, 0],
      retrievalModel: 'qwen/qwen3-embedding-0.6b',
      tags: ['猫', '橘子', '宠物'],
      importance: 0.9,
      observedStartAt: new Date('2026-04-17T09:55:00.000Z'),
      observedEndAt: new Date('2026-04-17T10:00:00.000Z'),
      createdAt: new Date('2026-04-17T10:00:00.000Z'),
    })

    const observerStarts: Array<{ kind: string; model: string }> = []
    const observerEnds: Array<{ metadata?: unknown }> = []
    const requests: Array<{
      systemPrompt: string
      model: string
      reasoning?: unknown
      responseFormat?: unknown
      messages?: Message[]
    }> = []
    const observer: RunAgentObserver = {
      onLLMCallStart(payload) {
        observerStarts.push({ kind: payload.kind, model: payload.model })
        return `call-${observerStarts.length}`
      },
      onLLMCallEnd(_callId, payload) {
        observerEnds.push({ metadata: payload.metadata })
      },
    }

    const provider = new FakeProvider(async function* (params) {
      requests.push({
        systemPrompt: params.systemPrompt,
        model: params.model,
        reasoning: params.reasoning,
        responseFormat: params.responseFormat,
        messages: params.messages,
      })

      if (isMemorySemanticPrompt(params.systemPrompt)) {
        assert.deepEqual(params.messages, [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: [
                  '最近对话（仅供补全当前问题）：',
                  '用户：我上周收养了一只猫。',
                  '我：记住了，你上周收养了一只猫。',
                  '用户：我给它起名叫橘子。',
                  '我：好的，我记住那只猫叫橘子。',
                  '',
                  '当前用户消息：',
                  '我猫叫什么',
                ].join('\n'),
              },
            ],
          },
        ])
        yield {
          type: 'message_complete',
          response: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  retrieval_query: '用户告诉过我的猫叫什么名字',
                }),
              },
            ],
            stopReason: 'end_turn',
            usage: { inputTokens: 5, outputTokens: 4 },
          },
        }
        return
      }

      if (params.systemPrompt.includes('"display_summary": string')) {
        yield {
          type: 'message_complete',
          response: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  display_summary: '用户养了一只叫橘子的猫',
                  retrieval_text: '用户曾告诉我，他养了一只名叫橘子的猫',
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

      assert.match(params.systemPrompt, /下面是本轮检索到的短期记忆。/)
      assert.match(params.systemPrompt, /短期最相关记忆：\[短期记忆\]\[发生于 \d{4}-\d{2}-\d{2} \d{2}:\d{2} [+-]\d{2}:\d{2} - \d{4}-\d{2}-\d{2} \d{2}:\d{2} [+-]\d{2}:\d{2}\]/)
      assert.match(params.systemPrompt, /固化记忆检索结果：未搜索到相关记忆。/)
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
      [
        createTextMessage('user', '我上周收养了一只猫。'),
        createTextMessage('assistant', '记住了，你上周收养了一只猫。'),
        createTextMessage('user', '我给它起名叫橘子。'),
        createTextMessage('assistant', '好的，我记住那只猫叫橘子。'),
        createTextMessage('user', '我猫叫什么'),
      ],
      provider,
      createSystems({
        memory: {
          scheme: 'sqlite',
          summarizeModel: 'memory-model',
          embeddingModel: 'qwen/qwen3-embedding-0.6b',
          retrieveTopK: 5,
          embedder: createEmbedder({
            '我猫叫什么': [1, 0],
            '用户告诉过我的猫叫什么名字': [1, 0],
            '用户曾告诉我，他养了一只名叫橘子的猫': [1, 0],
          }),
        },
      }),
      observer,
    )) {
      events.push(event)
    }

    assert.equal(events.at(-1)?.type, 'complete')
    assert.deepEqual(observerStarts, [
      { kind: 'memory', model: 'memory-model' },
      { kind: 'turn', model: 'fake-model' },
    ])
    assert.deepEqual(
      requests.map((request) => ({
        model: request.model,
        reasoning: request.reasoning,
        responseFormat: request.responseFormat && typeof request.responseFormat === 'object'
          ? {
              type: (request.responseFormat as { type?: unknown }).type,
              jsonSchema: {
                name: (
                  (request.responseFormat as { jsonSchema?: { name?: unknown } }).jsonSchema?.name
                ),
              },
            }
          : undefined,
        kind: isMemorySemanticPrompt(request.systemPrompt)
            ? 'retrieve_semantic'
          : request.systemPrompt.includes('"display_summary": string')
            ? 'summarize'
            : 'turn',
      })),
      [
        {
          kind: 'retrieve_semantic',
          model: 'memory-model',
          reasoning: { effort: 'none' },
          responseFormat: {
            type: 'json_schema',
            jsonSchema: { name: 'memory_semantic_query' },
          },
        },
        {
          kind: 'turn',
          model: 'fake-model',
          reasoning: { effort: 'none' },
          responseFormat: undefined,
        },
      ],
    )
    assert.deepEqual(observerEnds[0]?.metadata, {
      phase: 'retrieve',
      timeAnalyzer: {
        timeRange: null,
        error: null,
      },
      semanticAnalyzer: {
        retrievalQuery: '用户告诉过我的猫叫什么名字',
        mode: 'llm',
        inputPreview: [
          '最近对话（仅供补全当前问题）：',
          '用户：我上周收养了一只猫。',
          '我：记住了，你上周收养了一只猫。',
          '用户：我给它起名叫橘子。',
          '我：好的，我记住那只猫叫橘子。',
          '',
          '当前用户消息：',
          '我猫叫什么',
        ].join('\n'),
        error: null,
      },
      mergedQuery: {
        retrievalQuery: '用户告诉过我的猫叫什么名字',
        timeRange: null,
      },
      retrievalQuery: '用户告诉过我的猫叫什么名字',
      timeRange: null,
      hitCount: 1,
      shortTermHitCount: 1,
      fixedHitCount: 0,
      shortTermMemoryIds: [existingMemory.id],
      fixedMemoryIds: [],
      shortTermHits: [
        {
          id: existingMemory.id,
          summary: '用户养了一只叫橘子的猫',
          layer: 'short_term',
          importance: 0.9,
        },
      ],
      fixedHits: [],
      memoryIds: [existingMemory.id],
      hits: [
        {
          id: existingMemory.id,
          summary: '用户养了一只叫橘子的猫',
          layer: 'short_term',
          importance: 0.9,
        },
      ],
    })
    assert.equal(
      ((observerEnds[1]?.metadata as { memory?: { hitCount: number } })?.memory?.hitCount ?? 0),
      1,
    )

    const rows = memoryRepo.listMemoriesByAgent('agent-1')
    assert.equal(rows.length, 1)
    assert.equal(rows[0]!.displaySummary, '用户养了一只叫橘子的猫')
    assert.equal(rows[0]!.retrievalText, '用户曾告诉我，他养了一只名叫橘子的猫')
    assert.deepEqual(rows[0]!.retrievalEmbedding, [1, 0])
    assert.equal(rows[0]!.layer, 'short_term')
  } finally {
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('runner does not execute entity mention recall before composing the main turn prompt', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-memory-runner-'))
  const dbPath = join(dir, 'data.db')
  const memoryDbPath = join(dir, 'memory.db')

  try {
    bootstrapDb(dbPath, memoryDbPath)
    const now = new Date('2026-04-30T09:00:00.000Z')
    const wjj = episodicMemoryGraphRepo.createEntity({
      agentId: 'agent-1',
      type: 'person',
      canonicalName: 'WJJ',
      confidence: 0.95,
      aliases: [],
      now,
    })
    const bookstore = episodicMemoryGraphRepo.createEntity({
      agentId: 'agent-1',
      type: 'place',
      canonicalName: '安特卫普旧书店',
      confidence: 0.9,
      aliases: [{ alias: '旧书店', confidence: 0.8 }],
      now,
    })
    const caramel = episodicMemoryGraphRepo.createEntity({
      agentId: 'agent-1',
      type: 'object',
      canonicalName: '海盐焦糖',
      confidence: 0.9,
      aliases: [],
      now,
    })
    episodicMemoryGraphRepo.createEpisodicMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      summary: 'WJJ 在安特卫普旧书店提到过海盐焦糖。',
      sourceText: 'WJJ：旧书店那次我买了海盐焦糖。',
      sourceQuote: '旧书店那次我买了海盐焦糖',
      importance: 0.72,
      observedStartAt: now,
      observedEndAt: now,
      entityLinks: [
        { entityId: wjj.id, weight: 0.8 },
        { entityId: bookstore.id, weight: 1 },
        { entityId: caramel.id, weight: 0.7 },
      ],
      now,
    })

    const seenSystemPrompts: string[] = []
    let sawEntityMentionCall = false
    const provider = new FakeProvider(async function* (params) {
      if (params.systemPrompt.includes('实体 mention')) {
        sawEntityMentionCall = true
        yield {
          type: 'message_complete',
          response: {
            content: [{ type: 'text', text: JSON.stringify({
              mentions: [{ surface: '旧书店', type: 'place', context_hint: '旧书店地点', confidence: 0.9 }],
            }) }],
            stopReason: 'end_turn',
            usage: { inputTokens: 1, outputTokens: 1 },
          },
        }
        return
      }

      if (isMemorySemanticPrompt(params.systemPrompt)) {
        yield {
          type: 'message_complete',
          response: {
            content: [{ type: 'text', text: JSON.stringify({ retrieval_query: '那家旧书店后来怎么样了' }) }],
            stopReason: 'end_turn',
            usage: { inputTokens: 1, outputTokens: 1 },
          },
        }
        return
      }

      seenSystemPrompts.push(params.systemPrompt)
      yield {
        type: 'message_complete',
        response: {
          content: [{ type: 'text', text: 'ok' }],
          stopReason: 'end_turn',
          usage: { inputTokens: 1, outputTokens: 1 },
        },
      }
    })

    const events = []
    for await (const event of runAgent(
      createConfig(),
      [createTextMessage('user', '那家旧书店后来怎么样了？')],
      provider,
      createSystems({
        memory: {
          scheme: 'sqlite',
          embedder: createEmbedder({}),
        },
      }),
    )) {
      events.push(event)
      assert.notEqual(event.type, 'error')
    }

    assert.equal(events.some((event) => event.type === 'system_error'), false)
    assert.equal(sawEntityMentionCall, false)
    assert.doesNotMatch(seenSystemPrompts[0] ?? '', /此刻自然浮现的情景记忆/)
    assert.doesNotMatch(seenSystemPrompts[0] ?? '', /WJJ 在安特卫普旧书店提到过海盐焦糖/)
  } finally {
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('runAgent supports pure time-range recall without a retrieval query', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-memory-runner-'))
  const dbPath = join(dir, 'data.db')
  const memoryDbPath = join(dir, 'memory.db')

  try {
    bootstrapDb(dbPath, memoryDbPath)
    const existingMemory = memoryRepo.addMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      sourceText: '用户昨天晚饭吃了番茄鸡蛋面。',
      displaySummary: '用户昨晚吃了番茄鸡蛋面',
      retrievalText: '用户昨晚晚饭吃了番茄鸡蛋面，还加了很多胡椒。',
      retrievalEmbedding: [1, 0],
      retrievalModel: 'qwen/qwen3-embedding-0.6b',
      tags: ['晚饭', '番茄鸡蛋面'],
      importance: 0.8,
      observedStartAt: new Date('2026-04-19T18:30:00.000Z'),
      observedEndAt: new Date('2026-04-19T18:40:00.000Z'),
      createdAt: new Date('2026-04-19T18:30:00.000Z'),
    })

    const observerEnds: Array<{ metadata?: unknown; error?: string }> = []
    const provider = new FakeProvider(async function* (params) {
      if (isMemorySemanticPrompt(params.systemPrompt)) {
        yield {
          type: 'message_complete',
          response: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  retrieval_query: null,
                }),
              },
            ],
            stopReason: 'end_turn',
            usage: { inputTokens: 4, outputTokens: 3 },
          },
        }
        return
      }

      if (params.systemPrompt.includes('"display_summary": string')) {
        yield {
          type: 'message_complete',
          response: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  display_summary: '用户昨天提到自己昨晚吃了番茄鸡蛋面',
                  retrieval_text: '用户昨天提到自己昨晚吃了很多胡椒的番茄鸡蛋面。',
                  importance: 0.7,
                }),
              },
            ],
            stopReason: 'end_turn',
            usage: { inputTokens: 6, outputTokens: 8 },
          },
        }
        return
      }

      yield {
        type: 'message_complete',
        response: {
          content: [{ type: 'text', text: '你昨天提到晚饭吃了番茄鸡蛋面。' }],
          stopReason: 'end_turn',
          usage: { inputTokens: 12, outputTokens: 5 },
        },
      }
    })

    const observer: RunAgentObserver = {
      onLLMCallStart() {
        return 'call'
      },
      onLLMCallEnd(_callId, payload) {
        observerEnds.push({ metadata: payload.metadata, error: payload.error })
      },
    }

    const events = []
    for await (const event of runAgent(
      createConfig(),
      [createTextMessage('user', '昨天发生了什么')],
      provider,
      createSystems({
        memory: {
          scheme: 'sqlite',
          summarizeModel: 'memory-model',
          embeddingModel: 'qwen/qwen3-embedding-0.6b',
          retrieveTopK: 5,
          embedder: createEmbedder({
            '昨天发生了什么': [0, 1],
            '用户昨天提到自己昨晚吃了很多胡椒的番茄鸡蛋面。': [1, 0],
          }),
          timeParser: createTimeParser({
            '昨天发生了什么': {
              start: '2026-04-19T00:00:00.000Z',
              end: '2026-04-19T23:59:59.000Z',
            },
          }),
        },
      }),
      observer,
    )) {
      events.push(event)
    }

    assert.equal(events.at(-1)?.type, 'complete')
    const retrieveMetadata = observerEnds[0]?.metadata as {
      retrievalQuery?: string | null
      hitCount?: number
      memoryIds?: string[]
      timeRange?: { start: string; end: string } | null
    }
    assert.equal(retrieveMetadata?.retrievalQuery ?? null, null)
    assert.equal(retrieveMetadata?.hitCount, 1)
    assert.deepEqual(retrieveMetadata?.memoryIds, [existingMemory.id])
    assert.deepEqual((observerEnds[0]?.metadata as { timeAnalyzer?: unknown })?.timeAnalyzer, {
      timeRange: {
        start: '2026-04-19T00:00:00.000Z',
        end: '2026-04-19T23:59:59.000Z',
      },
      error: null,
    })
    assert.deepEqual((observerEnds[0]?.metadata as { semanticAnalyzer?: unknown })?.semanticAnalyzer, {
      retrievalQuery: null,
      mode: 'llm',
      inputPreview: [
        '最近对话（仅供补全当前问题）：',
        '（无）',
        '',
        '当前用户消息：',
        '昨天发生了什么',
      ].join('\n'),
      error: null,
    })
    assert.deepEqual(retrieveMetadata?.timeRange, {
      start: '2026-04-19T00:00:00.000Z',
      end: '2026-04-19T23:59:59.000Z',
    })
    assert.equal(observerEnds[0]?.error, undefined)
  } finally {
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('runAgent emits system_error and skips memory retrieval when memory query call throws', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-memory-runner-'))
  const dbPath = join(dir, 'data.db')
  const memoryDbPath = join(dir, 'memory.db')
  const observerEnds: Array<{ metadata?: unknown; error?: string }> = []
  const observer: RunAgentObserver = {
    onLLMCallStart() {
      return 'call-1'
    },
    onLLMCallEnd(_callId, payload) {
      observerEnds.push({ metadata: payload.metadata, error: payload.error })
    },
  }

  try {
    bootstrapDb(dbPath, memoryDbPath)

    const provider = new FakeProvider(async function* (params) {
    if (isMemorySemanticPrompt(params.systemPrompt)) {
      throw new Error('memory query failed')
    }

    if (params.systemPrompt.includes('"display_summary": string')) {
      yield {
        type: 'message_complete',
        response: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                display_summary: '用户养了一只叫橘子的猫',
                retrieval_text: '用户曾告诉我，他养了一只名叫橘子的猫',
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

    assert.match(params.systemPrompt, /^test\n\n当前本地时间：/)
    assert.match(params.systemPrompt, /短期记忆检索结果：未搜索到相关记忆。/)
    assert.match(params.systemPrompt, /固化记忆检索结果：未搜索到相关记忆。/)
    assert.match(params.systemPrompt, /短期记忆检索结果：未搜索到相关记忆。/)
    assert.match(params.systemPrompt, /固化记忆检索结果：未搜索到相关记忆。/)
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
          embeddingModel: 'qwen/qwen3-embedding-0.6b',
          retrieveTopK: 5,
          embedder: createEmbedder({}),
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
      timeAnalyzer: { timeRange: null, error: null },
      semanticAnalyzer: {
        retrievalQuery: null,
        mode: 'llm',
        inputPreview: [
          '最近对话（仅供补全当前问题）：',
          '（无）',
          '',
          '当前用户消息：',
          '我猫叫什么',
        ].join('\n'),
        error: 'memory query failed',
      },
      mergedQuery: { retrievalQuery: null, timeRange: null },
      retrievalQuery: null,
      timeRange: null,
    })
    assert.equal(observerEnds[0]?.error, 'memory query failed')
  } finally {
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('runAgent emits system_error and continues when memory retrieval throws', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-memory-runner-'))
  const dbPath = join(dir, 'data.db')
  const memoryDbPath = join(dir, 'memory.db')
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
          timeAnalyzer: {
            kind: 'local',
            analyze() {
              return { timeRange: null }
            },
          },
          semanticAnalyzer: {
            kind: 'llm',
            prompt: 'semantic analyzer prompt',
            inputText: ctx.input.text,
            responseFormat: undefined,
            parse() {
              return {
                retrievalQuery: '用户关于猫说过的话',
              }
            },
          },
          merge({ time, semantic }) {
            return {
              retrievalQuery: semantic.retrievalQuery,
              timeRange: time?.timeRange ?? null,
            }
          },
          retrieve() {
            throw new Error('memory retrieve failed')
          },
        }
      },
    },
  ]
  try {
    bootstrapDb(dbPath, memoryDbPath)

    const provider = new FakeProvider(async function* (params) {
    if (params.systemPrompt === 'semantic analyzer prompt') {
      yield {
        type: 'message_complete',
        response: {
          content: [{ type: 'text', text: JSON.stringify({ retrieval_query: '用户关于猫说过的话' }) }],
          stopReason: 'end_turn',
          usage: { inputTokens: 4, outputTokens: 4 },
        },
      }
      return
    }

    assert.match(params.systemPrompt, /^test\n\n当前本地时间：/)
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
      timeAnalyzer: { timeRange: null, error: null },
      semanticAnalyzer: {
        retrievalQuery: '用户关于猫说过的话',
        mode: 'llm',
        inputPreview: 'what did I say about my cat?',
        error: null,
      },
      mergedQuery: { retrievalQuery: '用户关于猫说过的话', timeRange: null },
      retrievalQuery: '用户关于猫说过的话',
      timeRange: null,
      hitCount: 0,
      shortTermHitCount: 0,
      fixedHitCount: 0,
      shortTermMemoryIds: [],
      fixedMemoryIds: [],
      shortTermHits: [],
      fixedHits: [],
      memoryIds: [],
      hits: [],
    })
    assert.equal(observerEnds[0]?.error, 'memory retrieve failed')
  } finally {
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('runAgent emits system_error without fallback retrieval when semantic analyzer returns no usable query', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-memory-runner-'))
  const dbPath = join(dir, 'data.db')
  const memoryDbPath = join(dir, 'memory.db')
  const observerEnds: Array<{ metadata?: unknown; error?: string }> = []
  const observer: RunAgentObserver = {
    onLLMCallStart() {
      return `call-${observerEnds.length + 1}`
    },
    onLLMCallEnd(_callId, payload) {
      observerEnds.push({ metadata: payload.metadata, error: payload.error })
    },
  }

  try {
    bootstrapDb(dbPath, memoryDbPath)

    const provider = new FakeProvider(async function* (params) {
    if (isMemorySemanticPrompt(params.systemPrompt)) {
      yield {
        type: 'message_complete',
        response: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ retrieval_query: null }),
            },
          ],
          stopReason: 'end_turn',
          usage: { inputTokens: 2, outputTokens: 2 },
        },
      }
      return
    }

    if (params.systemPrompt.includes('"display_summary": string')) {
      yield {
        type: 'message_complete',
        response: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                display_summary: '用户养了一只叫橘子的猫',
                retrieval_text: '用户曾告诉我，他养了一只名叫橘子的猫',
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

    assert.match(params.systemPrompt, /^test\n\n当前本地时间：/)
    assert.match(params.systemPrompt, /短期记忆检索结果：未搜索到相关记忆。/)
    assert.match(params.systemPrompt, /固化记忆检索结果：未搜索到相关记忆。/)
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
          embeddingModel: 'qwen/qwen3-embedding-0.6b',
          retrieveTopK: 5,
          embedder: createEmbedder({}),
          timeParser: createTimeParser({
            '我猫叫什么': null,
          }),
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
        error: 'Memory query analyzers returned neither retrieval_query nor time_range',
      })
    }

    assert.deepEqual(observerEnds[0]?.metadata, {
      phase: 'retrieve',
      timeAnalyzer: { timeRange: null, error: null },
      semanticAnalyzer: {
        retrievalQuery: null,
        mode: 'llm',
        inputPreview: [
          '最近对话（仅供补全当前问题）：',
          '（无）',
          '',
          '当前用户消息：',
          '我猫叫什么',
        ].join('\n'),
        error: null,
      },
      mergedQuery: { retrievalQuery: null, timeRange: null },
      retrievalQuery: null,
      timeRange: null,
    })
    assert.equal((observerEnds[2]?.metadata as { phase?: string })?.phase, 'retrieve')
    assert.deepEqual((observerEnds[2]?.metadata as { timeAnalyzer?: unknown })?.timeAnalyzer, {
      timeRange: null,
      error: null,
    })
    assert.deepEqual((observerEnds[2]?.metadata as { semanticAnalyzer?: unknown })?.semanticAnalyzer, {
      retrievalQuery: null,
      mode: 'llm',
      inputPreview: [
        '最近对话（仅供补全当前问题）：',
        '（无）',
        '',
        '当前用户消息：',
        '我猫叫什么',
      ].join('\n'),
      error: null,
    })
    assert.equal((observerEnds[2]?.metadata as { retrievalQuery?: string | null })?.retrievalQuery ?? null, null)
    assert.equal((observerEnds[2]?.metadata as { hitCount?: number })?.hitCount, undefined)
  } finally {
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('runAgent executes post-turn emotion, relationship, and memory LLM calls in parallel', async () => {
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
  const persisted: string[] = []
  let maxConcurrentPostTurnCalls = 0
  let activePostTurnCalls = 0

  const systems: AgentSystem[] = [
    {
      name: 'memory:sqlite',
      type: 'memory',
      async afterTurn(ctx) {
        ctx.pendingMemoryWrite = {
          kind: 'sqlite',
          system: 'memory:sqlite',
          model: 'memory-model',
          prompt: '记忆总结 prompt',
          sourceText: '用户：你好\n助手：你好呀',
          parse() {
            return {
              displaySummary: '用户打了招呼',
              retrievalText: '用户刚刚向我打了招呼',
              tags: ['打招呼'],
              importance: 0.4,
            }
          },
          async persist() {
            persisted.push('memory')
          },
        }
      },
    },
    {
      name: 'emotion:dimensional',
      type: 'emotion',
      async afterLLM(ctx) {
        ctx.pendingEmotionAnalysis = {
          kind: 'dimensional',
          model: 'emotion-model',
          systemPrompt: '情绪分析 prompt',
          messages: [{ role: 'user', content: [{ type: 'text', text: '情绪分析输入' }] }],
          currentState: { mood: 0, energy: 0, stress: 0 },
          baseline: { mood: 0, energy: 0, stress: 0 },
          decayPerTurn: 0.1,
        }
      },
      async afterTurn(ctx) {
        if (ctx.emotionAnalysis) {
          persisted.push('emotion')
        }
      },
    },
    {
      name: 'relationship:multi-dim',
      type: 'relationship',
      async afterLLM(ctx) {
        ctx.pendingRelationshipAnalysis = {
          kind: 'multi-dim',
          model: 'relationship-model',
          systemPrompt: '关系分析 prompt',
          messages: [{ role: 'user', content: [{ type: 'text', text: '关系分析输入' }] }],
          currentState: { trust: 0.5, affinity: 0.5, familiarity: 0.1, respect: 0.5 },
          baseline: { trust: 0.5, affinity: 0.5, familiarity: 0.1, respect: 0.5 },
          decayPerTurn: 0.1,
        }
      },
      async afterTurn(ctx) {
        if (ctx.relationshipAnalysis) {
          persisted.push('relationship')
        }
      },
    },
  ]

  const provider: LLMProvider = {
    name: 'parallel-fake',
    async *streamMessage(params) {
      assert.match(params.systemPrompt, /^test\n\n当前本地时间：/)
      yield {
        type: 'message_complete',
        response: {
          content: [{ type: 'text', text: '主回复完成' }],
          stopReason: 'end_turn',
          usage: { inputTokens: 8, outputTokens: 4 },
        },
      }
    },
    async sendMessage(params) {
      activePostTurnCalls += 1
      maxConcurrentPostTurnCalls = Math.max(maxConcurrentPostTurnCalls, activePostTurnCalls)
      await sleep(20)
      activePostTurnCalls -= 1

      if (params.systemPrompt === '情绪分析 prompt') {
        return {
          content: [{ type: 'text', text: '{"mood_delta":0.1,"energy_delta":0,"stress_delta":0,"trigger":"greeting"}' }],
          stopReason: 'end_turn',
          usage: { inputTokens: 3, outputTokens: 3 },
        }
      }

      if (params.systemPrompt === '关系分析 prompt') {
        return {
          content: [{ type: 'text', text: '{"trust_delta":0.05,"affinity_delta":0.04,"familiarity_delta":0.02,"respect_delta":0.01,"trigger":"greeting"}' }],
          stopReason: 'end_turn',
          usage: { inputTokens: 3, outputTokens: 3 },
        }
      }

      if (params.systemPrompt === '记忆总结 prompt') {
        return {
          content: [{ type: 'text', text: '{"display_summary":"用户打了招呼","retrieval_text":"用户刚刚向我打了招呼","importance":0.4}' }],
          stopReason: 'end_turn',
          usage: { inputTokens: 3, outputTokens: 3 },
        }
      }

      throw new Error(`Unexpected systemPrompt: ${params.systemPrompt}`)
    },
  }

  const events = []
  for await (const event of runAgent(
    createConfig(),
    [createTextMessage('user', '你好')],
    provider,
    systems,
  )) {
    events.push(event)
  }

  assert.equal(events.at(-1)?.type, 'complete')
  assert.equal(maxConcurrentPostTurnCalls, 3)
  assert.deepEqual(persisted.sort(), ['emotion', 'memory', 'relationship'])
})
