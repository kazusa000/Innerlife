import assert from 'node:assert/strict'
import test from 'node:test'
import { runAgent } from './runner'
import type { AgentConfig } from './types'
import type { LLMProvider, LLMRequest, LLMResponse, LLMStreamEvent } from '../provider/types'
import type { Tool } from '../tools/types'
import type { ContentBlock, Message, ToolDefinition } from '../types'
import { createSystems, type AgentSystem, type TurnContext } from '@mas/systems'
import { getDb, getRawSqlite, resetDb } from '@mas/db'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

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

function createConfig(tools: Tool[] = []): AgentConfig {
  return {
    id: 'test-agent',
    model: 'fake-model',
    systemPrompt: 'test',
    tools,
    maxTurns: 2,
  }
}

function createTextMessage(role: Message['role'], text: string): Message {
  return {
    role,
    content: [{ type: 'text', text }],
  }
}

function clone<T>(value: T): T {
  if (value === undefined) {
    return value
  }
  return JSON.parse(JSON.stringify(value))
}

test('runAgent stops before executing a tool when signal aborts after tool-use response', async () => {
  const abortController = new AbortController()
  let toolCalled = false

  const tool: Tool = {
    name: 'bash',
    description: 'test tool',
    inputSchema: { type: 'object' },
    async call() {
      toolCalled = true
      return { output: 'should not run' }
    },
  }

  const provider = new FakeProvider(async function* () {
    abortController.abort()
    yield {
      type: 'message_complete',
      response: {
        content: [
          {
            type: 'tool_use',
            id: 'tool-1',
            name: 'bash',
            input: { command: 'sleep 5' },
          },
        ],
        stopReason: 'tool_use',
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    }
  })

  const events = []
  for await (const event of runAgent(
    createConfig([tool]),
    [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    provider,
    [],
    undefined,
    abortController.signal,
  )) {
    events.push(event)
  }

  assert.deepEqual(events, [{ type: 'aborted' }])
  assert.equal(toolCalled, false)
})

test('runAgent emits aborted when provider stream is cancelled mid-response', async () => {
  const abortController = new AbortController()

  const provider = new FakeProvider(async function* ({ signal }) {
    yield { type: 'text_delta', text: 'hello' }
    abortController.abort()
    signal?.throwIfAborted()
  })

  const events = []
  for await (const event of runAgent(
    createConfig(),
    [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    provider,
    [],
    undefined,
    abortController.signal,
  )) {
    events.push(event)
  }

  assert.deepEqual(events, [
    { type: 'text_delta', text: 'hello' },
    { type: 'aborted' },
  ])
})

test('runAgent continues the same turn after search_long_term_memory returns a result', async () => {
  let llmCallCount = 0
  const llmRequests: LLMRequest[] = []

  const tool: Tool = {
    name: 'search_long_term_memory',
    description: '只在必要时搜索长期记忆。',
    inputSchema: { type: 'object' },
    async call() {
      return {
        output: '长期记忆检索结果：\n[长期记忆][2026-04-01 03:00 +00:00] 用户最喜欢凌晨三点写代码。',
      }
    },
  }

  const provider = new FakeProvider(async function* (params) {
    llmCallCount += 1
    llmRequests.push(clone(params))

    if (llmCallCount === 1) {
      yield {
        type: 'message_complete',
        response: {
          content: [
            {
              type: 'tool_use',
              id: 'tool-1',
              name: 'search_long_term_memory',
              input: { query: '用户喜欢在什么时间写代码' },
            },
          ],
          stopReason: 'tool_use',
          usage: { inputTokens: 10, outputTokens: 5 },
        },
      }
      return
    }

    yield {
      type: 'message_complete',
      response: {
        content: [
          {
            type: 'text',
            text: '你之前提到自己最喜欢凌晨三点写代码，因为那时最安静。',
          },
        ],
        stopReason: 'end_turn',
        usage: { inputTokens: 12, outputTokens: 8 },
      },
    }
  })

  const events = []
  for await (const event of runAgent(
    createConfig([tool]),
    [createTextMessage('user', '你还记得我之前最喜欢在什么时间写代码吗？')],
    provider,
  )) {
    events.push(event)
  }

  assert.equal(llmCallCount, 2)
  assert.deepEqual(
    events.map((event) => event.type),
    ['tool_start', 'tool_result', 'complete'],
  )
  assert.equal(
    (events[1] as Extract<(typeof events)[number], { type: 'tool_result' }>).result.output,
    '长期记忆检索结果：\n[长期记忆][2026-04-01 03:00 +00:00] 用户最喜欢凌晨三点写代码。',
  )
  assert.match(
    JSON.stringify(llmRequests[1]?.messages ?? []),
    /长期记忆检索结果/,
  )
})

test('runAgent passes semantic memory retrieval query into tool execution options', async () => {
  let seenToolOptions: Record<string, unknown> | undefined

  const tool: Tool = {
    name: 'search_long_term_memory',
    description: '只在必要时搜索长期记忆。',
    inputSchema: { type: 'object' },
    async call(_input, options) {
      seenToolOptions = options as Record<string, unknown>
      return {
        output: '长期记忆检索结果：\n[长期记忆][2026-04-01 03:00 +00:00] 用户养过一只叫南瓜的猫。',
      }
    },
  }

  const provider = new FakeProvider(async function* (_params) {
    yield {
      type: 'message_complete',
      response: {
        content: [
          {
            type: 'tool_use',
            id: 'tool-1',
            name: 'search_long_term_memory',
            input: { query: '猫 宠物 名字' },
          },
        ],
        stopReason: 'tool_use',
        usage: { inputTokens: 10, outputTokens: 5 },
      },
    }
  })

  const systems: AgentSystem[] = [
    {
      name: 'memory:probe',
      type: 'memory',
      async beforeTurn(ctx: TurnContext) {
        ctx.state.memoryRetrievalQuery = '我们养的那只猫叫什么名字'
      },
    },
  ]

  const events = []
  for await (const event of runAgent(
    createConfig([tool]),
    [createTextMessage('user', '你还记得我们养的那只猫叫什么名字吗？')],
    provider,
    systems,
  )) {
    events.push(event)
  }

  assert.equal(events[0]?.type, 'tool_start')
  assert.equal(seenToolOptions?.memoryRetrievalQuery, '我们养的那只猫叫什么名字')
  const recentMessages = seenToolOptions?.recentMessages as unknown[]
  assert.ok(recentMessages.some((message) =>
    JSON.stringify(message) === JSON.stringify(createTextMessage('user', '你还记得我们养的那只猫叫什么名字吗？')),
  ))
})

test('runAgent composes sorted prompt fragments from systems before calling the provider', async () => {
  const seen: { systemPrompt?: string; reasoning?: unknown } = {}

  const provider = new FakeProvider(async function* (params) {
    seen.systemPrompt = params.systemPrompt
    seen.reasoning = params.reasoning
    yield {
      type: 'message_complete',
      response: {
        content: [{ type: 'text', text: 'done' }],
        stopReason: 'end_turn',
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    }
  })

  const systems: AgentSystem[] = [
    {
      name: 'late-fragment',
      type: 'debug',
      async beforeLLM(ctx: TurnContext) {
        ctx.promptFragments.push({
          source: 'late-fragment',
          priority: 50,
          content: 'third',
        })
      },
    },
    {
      name: 'early-fragment',
      type: 'debug',
      async beforeLLM(ctx: TurnContext) {
        ctx.promptFragments.push({
          source: 'early-fragment',
          priority: 10,
          content: 'first',
        })
      },
    },
    {
      name: 'middle-fragment',
      type: 'debug',
      async beforeLLM(ctx: TurnContext) {
        ctx.promptFragments.push({
          source: 'middle-fragment',
          priority: 20,
          content: 'second',
        })
      },
    },
  ]

  const events = []
  for await (const event of runAgent(
    createConfig(),
    [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    provider,
    systems,
  )) {
    events.push(event)
  }

  assert.deepEqual(events, [
    {
      type: 'complete',
      response: {
        content: [{ type: 'text', text: 'done' }],
        stopReason: 'end_turn',
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    },
  ])
  assert.match(seen.systemPrompt ?? '', /^test\n\n当前本地时间：.+\n\nfirst\n\nsecond\n\nthird$/)
  assert.deepEqual(seen.reasoning, { effort: 'none' })
})

test('runAgent passes configured reasoning and streams thinking deltas', async () => {
  const seen: { reasoning?: unknown; systemPrompt?: string } = {}

  const provider = new FakeProvider(async function* (params) {
    seen.reasoning = params.reasoning
    seen.systemPrompt = params.systemPrompt
    yield { type: 'thinking_delta', text: '先判断问题类型。' }
    yield { type: 'text_delta', text: 'done' }
    yield {
      type: 'message_complete',
      response: {
        content: [{ type: 'text', text: 'done' }],
        stopReason: 'end_turn',
        usage: { inputTokens: 1, outputTokens: 2 },
      },
    }
  })

  const events = []
  for await (const event of runAgent(
    {
      ...createConfig(),
      reasoning: { enabled: true, effort: 'medium' },
    },
    [createTextMessage('user', '需要想一下吗？')],
    provider,
  )) {
    events.push(event)
  }

  assert.deepEqual(seen.reasoning, { enabled: true, effort: 'medium' })
  assert.deepEqual(events, [
    { type: 'thinking_delta', text: '先判断问题类型。' },
    { type: 'text_delta', text: 'done' },
    {
      type: 'complete',
      response: {
        content: [{ type: 'text', text: 'done' }],
        stopReason: 'end_turn',
        usage: { inputTokens: 1, outputTokens: 2 },
      },
    },
  ])
  assert.doesNotMatch(seen.systemPrompt ?? '', /【角色沉浸要求】/)
})

test('runAgent appends persona thinking prompt only when configured', async () => {
  const seen: { systemPrompt?: string } = {}
  const provider = new FakeProvider(async function* (params) {
    seen.systemPrompt = params.systemPrompt
    yield {
      type: 'message_complete',
      response: {
        content: [{ type: 'text', text: 'done' }],
        stopReason: 'end_turn',
        usage: { inputTokens: 1, outputTokens: 2 },
      },
    }
  })

  for await (const _event of runAgent(
    {
      ...createConfig(),
      reasoning: { enabled: true, effort: 'medium' },
      thinkingRoleImmersionPrompt: '自定义思考规则',
    },
    [createTextMessage('user', '需要想一下吗？')],
    provider,
  )) {
    // Drain stream.
  }

  assert.match(seen.systemPrompt ?? '', /test[\s\S]*自定义思考规则$/)
})

test('runAgent suppresses provider thinking deltas when reasoning is disabled', async () => {
  const provider = new FakeProvider(async function* () {
    yield { type: 'thinking_delta', text: '不应该显示。' }
    yield { type: 'text_delta', text: 'done' }
    yield {
      type: 'message_complete',
      response: {
        content: [
          { type: 'thinking', thinking: '不应该显示。', signature: 'sig-1' },
          { type: 'text', text: 'done' },
        ],
        stopReason: 'end_turn',
        usage: { inputTokens: 1, outputTokens: 2 },
      },
    }
  })

  const events = []
  for await (const event of runAgent(
    {
      ...createConfig(),
      reasoning: { effort: 'none' },
    },
    [createTextMessage('user', '不要显示思考')],
    provider,
  )) {
    events.push(event)
  }

  assert.deepEqual(events, [
    { type: 'text_delta', text: 'done' },
    {
      type: 'complete',
      response: {
        content: [
          { type: 'thinking', thinking: '不应该显示。', signature: 'sig-1' },
          { type: 'text', text: 'done' },
        ],
        stopReason: 'end_turn',
        usage: { inputTokens: 1, outputTokens: 2 },
      },
    },
  ])
})

test('runAgent snapshots normalized prompt fragments into observer metadata', async () => {
  const observerStarts: Array<{ metadata?: Record<string, unknown> }> = []
  const observerEnds: Array<{ metadata?: Record<string, unknown> }> = []

  const provider = new FakeProvider(async function* () {
    yield {
      type: 'message_complete',
      response: {
        content: [{ type: 'text', text: 'done' }],
        stopReason: 'end_turn',
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    }
  })

  const systems: AgentSystem[] = [
    {
      name: 'personality:big-five',
      type: 'personality',
      async beforeLLM(ctx: TurnContext) {
        ctx.promptFragments.push({
          source: 'personality:big-five',
          priority: 10,
          content: 'personality fragment',
        })
      },
    },
    {
      name: 'emotion:dimensional',
      type: 'emotion',
      async beforeLLM(ctx: TurnContext) {
        ctx.promptFragments.push({
          source: 'emotion:dimensional',
          priority: 50,
          content: 'emotion fragment',
        })
      },
    },
  ]

  const observer = {
    onLLMCallStart(payload: {
      metadata?: Record<string, unknown>
    }) {
      observerStarts.push({ metadata: clone(payload.metadata) })
      return `call-${observerStarts.length}`
    },
    onLLMCallEnd(_callId: string, payload: {
      metadata?: Record<string, unknown>
    }) {
      observerEnds.push({ metadata: clone(payload.metadata) })
    },
  }

  for await (const _event of runAgent(
    createConfig(),
    [createTextMessage('user', 'hi')],
    provider,
    systems,
    observer,
  )) {
  }

  assert.deepEqual(observerStarts[0]?.metadata, {
    fragments: [
      {
        source: 'personality',
        priority: 10,
        content: 'personality fragment',
      },
      {
        source: 'emotion',
        priority: 50,
        content: 'emotion fragment',
      },
    ],
  })
  assert.deepEqual(observerEnds[0]?.metadata, {
    fragments: [
      {
        source: 'personality',
        priority: 10,
        content: 'personality fragment',
      },
      {
        source: 'emotion',
        priority: 50,
        content: 'emotion fragment',
      },
    ],
  })
})

test('runAgent ignores legacy big-five personality configs', async () => {
  async function captureSystemPrompt(systems: AgentSystem[]) {
    let systemPrompt = ''
    const provider = new FakeProvider(async function* (params) {
      systemPrompt = params.systemPrompt
      yield {
        type: 'message_complete',
        response: {
          content: [{ type: 'text', text: 'done' }],
          stopReason: 'end_turn',
          usage: { inputTokens: 1, outputTokens: 1 },
        },
      }
    })

    for await (const _event of runAgent(
      createConfig(),
      [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      provider,
      systems,
    )) {
    }

    return systemPrompt
  }

  const bigFivePrompt = await captureSystemPrompt(createSystems({
    personality: {
      scheme: 'big-five',
      big5: {
        openness: 0.85,
        conscientiousness: 0.55,
        extraversion: 0.25,
        agreeableness: 0.7,
        neuroticism: 0.2,
      },
      speechStyle: '简洁、口语化',
      background: '一位前端工程师',
    },
  }))

  assert.match(bigFivePrompt, /^test\n\n当前本地时间：.+$/)

  const noopPrompt = await captureSystemPrompt(createSystems({
    personality: { scheme: 'noop' },
  }))

  assert.match(noopPrompt, /^test\n\n当前本地时间：.+$/)
})

test('runAgent emits system_error and continues when a system hook throws', async () => {
  const provider = new FakeProvider(async function* (params) {
    assert.match(params.systemPrompt, /^test\n\n当前本地时间：.+\n\nstill here$/)
    yield {
      type: 'message_complete',
      response: {
        content: [{ type: 'text', text: 'ok' }],
        stopReason: 'end_turn',
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    }
  })

  const systems: AgentSystem[] = [
    {
      name: 'broken-system',
      type: 'debug',
      async beforeLLM() {
        throw new Error('hook failed')
      },
    },
    {
      name: 'healthy-system',
      type: 'debug',
      async beforeLLM(ctx: TurnContext) {
        ctx.promptFragments.push({
          source: 'healthy-system',
          priority: 5,
          content: 'still here',
        })
      },
    },
  ]

  const events = []
  for await (const event of runAgent(
    createConfig(),
    [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    provider,
    systems,
  )) {
    events.push(
      event.type === 'error'
        ? { type: 'error', error: event.error.message }
        : event.type === 'system_error'
          ? { type: 'system_error', system: event.system, error: event.error.message, phase: event.phase }
          : event,
    )
  }

  assert.deepEqual(events, [
    {
      type: 'system_error',
      system: 'broken-system',
      phase: 'beforeLLM',
      error: 'hook failed',
    },
    {
      type: 'complete',
      response: {
        content: [{ type: 'text', text: 'ok' }],
        stopReason: 'end_turn',
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    },
  ])
})

test('runAgent lets systems share turn state across lifecycle hooks', async () => {
  const phases: string[] = []

  const provider = new FakeProvider(async function* () {
    phases.push('provider')
    yield {
      type: 'message_complete',
      response: {
        content: [{ type: 'text', text: 'response' }],
        stopReason: 'end_turn',
        usage: { inputTokens: 2, outputTokens: 3 },
      },
    }
  })

  const systems: AgentSystem[] = [
    {
      name: 'stateful-system',
      type: 'debug',
      async beforeTurn(ctx: TurnContext) {
        phases.push('beforeTurn')
        ctx.state.debug = { seenText: ctx.input.text }
      },
      async beforeLLM(ctx: TurnContext) {
        phases.push('beforeLLM')
        const debugState = ctx.state.debug as { seenText: string }
        ctx.promptFragments.push({
          source: 'stateful-system',
          priority: 1,
          content: `echo:${debugState.seenText}`,
        })
      },
      async afterLLM(ctx: TurnContext) {
        phases.push('afterLLM')
        ctx.state.after = (ctx.response?.content[0] as ContentBlock & { type: 'text'; text: string }).text
      },
      async afterTurn(ctx: TurnContext) {
        phases.push('afterTurn')
        assert.deepEqual(ctx.state, {
          debug: { seenText: 'hi there' },
          after: 'response',
        })
      },
    },
  ]

  const events = []
  for await (const event of runAgent(
    createConfig(),
    [{ role: 'user', content: [{ type: 'text', text: 'hi there' }] }],
    provider,
    systems,
  )) {
    events.push(event)
  }

  assert.equal(events.at(-1)?.type, 'complete')
  assert.deepEqual(phases, [
    'beforeTurn',
    'beforeLLM',
    'provider',
    'afterLLM',
    'afterTurn',
  ])
})

test('runAgent compacts older messages before the main LLM call and records compaction metadata', async () => {
  const seenRequests: Array<{ systemPrompt: string; messages: Message[] }> = []
  const observerStarts: Array<{
    kind?: string
    systemPrompt: string
    messages: Message[]
  }> = []
  const observerEnds: Array<{
    metadata?: unknown
    error?: string
  }> = []

  const provider = new FakeProvider(async function* (params) {
    seenRequests.push({
      systemPrompt: params.systemPrompt,
      messages: clone(params.messages as Message[]),
    })

    if (seenRequests.length === 1) {
      yield {
        type: 'message_complete',
        response: {
          content: [
            {
              type: 'text',
              text: [
                '关键事实：用户正在做 B5',
                '用户偏好：回答简洁',
                '未完成事项：完成上下文压缩',
              ].join('\n'),
            },
          ],
          stopReason: 'end_turn',
          usage: { inputTokens: 10, outputTokens: 20 },
        },
      }
      return
    }

    assert.equal(params.messages.length, 20)
    assert.match(params.systemPrompt, /回答简洁/)
    yield {
      type: 'message_complete',
      response: {
        content: [{ type: 'text', text: 'final answer' }],
        stopReason: 'end_turn',
        usage: { inputTokens: 5, outputTokens: 7 },
      },
    }
  })

  const observer = {
    onLLMCallStart(payload: {
      kind?: string
      systemPrompt: string
      messages: Message[]
    }) {
      observerStarts.push({
        kind: payload.kind,
        systemPrompt: payload.systemPrompt,
        messages: clone(payload.messages),
      })
      return `call-${observerStarts.length}`
    },
    onLLMCallEnd(
      _callId: string,
      payload: {
        metadata?: unknown
        error?: string
      },
    ) {
      observerEnds.push({
        metadata: clone(payload.metadata),
        error: payload.error,
      })
    },
  }

  const messages = Array.from({ length: 45 }, (_, index) =>
    createTextMessage(index % 2 === 0 ? 'user' : 'assistant', `message ${index}`),
  )

  const events = []
  for await (const event of runAgent(
    createConfig(),
    messages,
    provider,
    createSystems({ compaction: 'summary' }),
    observer,
  )) {
    events.push(event)
  }

  assert.equal(events.at(-1)?.type, 'complete')
  assert.equal(seenRequests.length, 2)
  assert.equal(observerStarts[0]?.kind, 'compaction')
  assert.equal(observerStarts[1]?.kind, 'turn')
  assert.equal(observerStarts[1]?.messages.length, 21)
  assert.equal(observerStarts[1]?.messages[0]?.role, 'system')

  assert.deepEqual(observerEnds[0]?.metadata, {
    reason: {
      type: 'message_count',
      messageCount: 45,
    },
    beforeMessageCount: 45,
    afterMessageCount: 21,
    summary: [
      '关键事实：用户正在做 B5',
      '用户偏好：回答简洁',
      '未完成事项：完成上下文压缩',
    ].join('\n'),
    beforeMessages: Array.from({ length: 45 }, (_, index) =>
      createTextMessage(index % 2 === 0 ? 'user' : 'assistant', `message ${index}`),
    ),
    afterMessages: [
      {
        role: 'system',
        content: [
          {
            type: 'text',
            text: [
              '对话摘要：',
              '关键事实：用户正在做 B5',
              '用户偏好：回答简洁',
              '未完成事项：完成上下文压缩',
            ].join('\n'),
          },
        ],
      },
      ...Array.from({ length: 20 }, (_, index) =>
        createTextMessage((index + 25) % 2 === 0 ? 'user' : 'assistant', `message ${index + 25}`),
      ),
    ],
  })
})

test('runAgent executes pending emotion analysis as a separate observer call and exposes parsed deltas to afterTurn', async () => {
  const observerStarts: Array<{ kind: string; model: string; systemPrompt: string }> = []
  const observerEnds: Array<{ callId: string; metadata?: Record<string, unknown> }> = []
  const seen: { emotionRequest?: LLMRequest; analysis?: unknown } = {}

  const provider: LLMProvider = {
    name: 'fake',
    async *streamMessage(params) {
      assert.equal(params.model, 'fake-model')
      yield {
        type: 'message_complete',
        response: {
          content: [{ type: 'text', text: 'answer' }],
          stopReason: 'end_turn',
          usage: { inputTokens: 8, outputTokens: 6 },
        },
      }
    },
    async sendMessage(params) {
      seen.emotionRequest = params
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              mood_delta: -0.25,
              energy_delta: 0.1,
              stress_delta: 0.2,
              trigger: '用户用了责备语气',
            }),
          },
        ],
        stopReason: 'end_turn',
        usage: { inputTokens: 5, outputTokens: 7 },
      }
    },
  }

  const systems: AgentSystem[] = [
    {
      name: 'emotion:dimensional',
      type: 'emotion',
      async afterLLM(ctx: TurnContext) {
        ctx.pendingEmotionAnalysis = {
          kind: 'dimensional',
          model: 'claude-haiku-4-5-20251001',
          systemPrompt: '你负责分析单轮对话对情绪状态的影响，只输出 JSON。',
          messages: [
            createTextMessage('user', '用户说：你怎么这么慢\n助手回复：answer'),
          ],
          currentState: {
            mood: 0.1,
            energy: 0.2,
            stress: 0.3,
          },
          baseline: {
            mood: 0,
            energy: 0,
            stress: 0,
          },
          decayPerTurn: 0.15,
        }
      },
      async afterTurn(ctx: TurnContext) {
        seen.analysis = clone(ctx.emotionAnalysis)
      },
    },
  ]

  const observer = {
    onLLMCallStart(payload: {
      kind: 'turn' | 'compaction' | 'emotion'
      model: string
      systemPrompt: string
      tools: ToolDefinition[]
      messages: Message[]
    }) {
      observerStarts.push({
        kind: payload.kind,
        model: payload.model,
        systemPrompt: payload.systemPrompt,
      })
      return `call-${observerStarts.length}`
    },
    onLLMCallEnd(callId: string, payload: {
      response: ContentBlock[]
      stopReason: LLMResponse['stopReason']
      usage: { inputTokens: number; outputTokens: number }
      metadata?: Record<string, unknown>
      error?: string
    }) {
      observerEnds.push({ callId, metadata: clone(payload.metadata) })
    },
  }

  const events = []
  for await (const event of runAgent(
    createConfig(),
    [createTextMessage('user', 'hello')],
    provider,
    systems,
    observer,
  )) {
    events.push(event)
  }

  assert.deepEqual(events, [
    {
      type: 'complete',
      response: {
        content: [{ type: 'text', text: 'answer' }],
        stopReason: 'end_turn',
        usage: { inputTokens: 8, outputTokens: 6 },
      },
    },
  ])
  assert.equal(seen.emotionRequest?.model, 'claude-haiku-4-5-20251001')
  assert.equal(seen.emotionRequest?.systemPrompt, '你负责分析单轮对话对情绪状态的影响，只输出 JSON。')
  assert.deepEqual(seen.emotionRequest?.reasoning, { effort: 'none' })
  assert.deepEqual(observerStarts.map((item) => item.kind), ['turn', 'emotion'])
  assert.deepEqual(seen.analysis, {
    delta: {
      mood: -0.25,
      energy: 0.1,
      stress: 0.2,
    },
    trigger: '用户用了责备语气',
    rawResponse: '{"mood_delta":-0.25,"energy_delta":0.1,"stress_delta":0.2,"trigger":"用户用了责备语气"}',
  })
  assert.deepEqual(observerEnds[1]?.metadata, {
    before: {
      mood: 0.1,
      energy: 0.2,
      stress: 0.3,
    },
    after: {
      mood: -0.165,
      energy: 0.27,
      stress: 0.455,
    },
    delta: {
      mood: -0.25,
      energy: 0.1,
      stress: 0.2,
    },
    trigger: '用户用了责备语气',
  })
})

test('runAgent executes pending relationship analysis as a separate observer call and exposes parsed deltas to afterTurn', async () => {
  const observerStarts: Array<{ kind: string; model: string; systemPrompt: string }> = []
  const observerEnds: Array<{ callId: string; metadata?: Record<string, unknown> }> = []
  const seen: { relationshipRequest?: LLMRequest; analysis?: unknown } = {}

  const provider: LLMProvider = {
    name: 'fake',
    async *streamMessage(params) {
      assert.equal(params.model, 'fake-model')
      yield {
        type: 'message_complete',
        response: {
          content: [{ type: 'text', text: 'answer' }],
          stopReason: 'end_turn',
          usage: { inputTokens: 8, outputTokens: 6 },
        },
      }
    },
    async sendMessage(params) {
      seen.relationshipRequest = params
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              trust_delta: 0.1,
              affinity_delta: -0.05,
              familiarity_delta: 0.2,
              respect_delta: 0.03,
              trigger: '用户分享了新的上下文并认可了当前方案',
            }),
          },
        ],
        stopReason: 'end_turn',
        usage: { inputTokens: 5, outputTokens: 7 },
      }
    },
  }

  const systems: AgentSystem[] = [
    {
      name: 'relationship:multi-dim',
      type: 'relationship',
      async afterLLM(ctx: TurnContext) {
        ctx.pendingRelationshipAnalysis = {
          kind: 'multi-dim',
          model: 'claude-haiku-4-5-20251001',
          systemPrompt: '你负责分析单轮对话对关系状态的影响，只输出 JSON。',
          messages: [
            createTextMessage('user', '用户说：这次你的方案靠谱多了\n助手回复：answer'),
          ],
          currentState: {
            trust: 0.4,
            affinity: 0.6,
            familiarity: 0.2,
            respect: 0.8,
          },
          baseline: {
            trust: 0.3,
            affinity: 0.5,
            familiarity: 0.1,
            respect: 0.7,
          },
          decayPerTurn: 0.2,
        }
      },
      async afterTurn(ctx: TurnContext) {
        seen.analysis = clone(ctx.relationshipAnalysis)
      },
    },
  ]

  const observer = {
    onLLMCallStart(payload: {
      kind: 'turn' | 'compaction' | 'emotion' | 'relationship'
      model: string
      systemPrompt: string
      tools: ToolDefinition[]
      messages: Message[]
    }) {
      observerStarts.push({
        kind: payload.kind,
        model: payload.model,
        systemPrompt: payload.systemPrompt,
      })
      return `call-${observerStarts.length}`
    },
    onLLMCallEnd(callId: string, payload: {
      response: ContentBlock[]
      stopReason: LLMResponse['stopReason']
      usage: { inputTokens: number; outputTokens: number }
      metadata?: Record<string, unknown>
      error?: string
    }) {
      observerEnds.push({ callId, metadata: clone(payload.metadata) })
    },
  }

  const events = []
  for await (const event of runAgent(
    createConfig(),
    [createTextMessage('user', 'hello')],
    provider,
    systems,
    observer,
  )) {
    events.push(event)
  }

  assert.deepEqual(events, [
    {
      type: 'complete',
      response: {
        content: [{ type: 'text', text: 'answer' }],
        stopReason: 'end_turn',
        usage: { inputTokens: 8, outputTokens: 6 },
      },
    },
  ])
  assert.equal(seen.relationshipRequest?.model, 'claude-haiku-4-5-20251001')
  assert.equal(seen.relationshipRequest?.systemPrompt, '你负责分析单轮对话对关系状态的影响，只输出 JSON。')
  assert.deepEqual(seen.relationshipRequest?.reasoning, { effort: 'none' })
  assert.deepEqual(observerStarts.map((item) => item.kind), ['turn', 'relationship'])
  assert.deepEqual(seen.analysis, {
    delta: {
      trust: 0.1,
      affinity: -0.05,
      familiarity: 0.2,
      respect: 0.03,
    },
    trigger: '用户分享了新的上下文并认可了当前方案',
    rawResponse: '{"trust_delta":0.1,"affinity_delta":-0.05,"familiarity_delta":0.2,"respect_delta":0.03,"trigger":"用户分享了新的上下文并认可了当前方案"}',
  })
  assert.deepEqual(observerEnds[1]?.metadata, {
    before: {
      trust: 0.4,
      affinity: 0.6,
      familiarity: 0.2,
      respect: 0.8,
    },
    after: {
      trust: 0.48,
      affinity: 0.53,
      familiarity: 0.38,
      respect: 0.81,
    },
    delta: {
      trust: 0.1,
      affinity: -0.05,
      familiarity: 0.2,
      respect: 0.03,
    },
    trigger: '用户分享了新的上下文并认可了当前方案',
    counterpartId: null,
    counterpartName: null,
    counterpartType: null,
  })
})

function bootstrapRelationshipDb(dbPath: string) {
  resetDb()
  getDb(dbPath)
  getRawSqlite().exec(`
    CREATE TABLE IF NOT EXISTS agents (
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
    CREATE TABLE IF NOT EXISTS relationships (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id),
      counterpart_type TEXT NOT NULL,
      counterpart_id TEXT NOT NULL,
      dimensions TEXT NOT NULL,
      history TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_relationships_agent_counterpart
      ON relationships(agent_id, counterpart_type, counterpart_id);
    DELETE FROM relationships;
    DELETE FROM agents;
    INSERT INTO agents (id, name, model, status)
    VALUES ('test-agent', 'Relationship Agent', 'fake-model', 'idle');
  `)
}

test('runAgent with noop relationship config injects no fragment and writes no relationship rows', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-relationship-noop-'))
  const dbPath = join(dir, 'relationship.db')

  try {
    bootstrapRelationshipDb(dbPath)

    let systemPrompt = ''
    const provider = new FakeProvider(async function* (params) {
      systemPrompt = params.systemPrompt
      yield {
        type: 'message_complete',
        response: {
          content: [{ type: 'text', text: 'done' }],
          stopReason: 'end_turn',
          usage: { inputTokens: 1, outputTokens: 1 },
        },
      }
    })

    for await (const _event of runAgent(
      createConfig(),
      [createTextMessage('user', 'hi')],
      provider,
      createSystems({
        relationship: { scheme: 'noop' },
      }),
    )) {
    }

    const countRow = getRawSqlite().prepare('SELECT COUNT(*) AS count FROM relationships').get() as {
      count: number
    }
    assert.match(systemPrompt, /^test\n\n当前本地时间：.+$/)
    assert.equal(countRow.count, 0)
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('runAgent includes relationship prompts and high/low states lead to observably different replies', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-relationship-diff-'))
  const dbPath = join(dir, 'relationship.db')

  try {
    bootstrapRelationshipDb(dbPath)

    const prompts: string[] = []
    const provider = new FakeProvider(async function* (params) {
      prompts.push(params.systemPrompt)

      const reply = params.systemPrompt.includes('高度信任') && params.systemPrompt.includes('非常熟悉')
        ? '当然，我直接帮你把这件事接着做完。'
        : '我会先谨慎确认你的意图，再继续处理。'

      yield {
        type: 'message_complete',
        response: {
          content: [{ type: 'text', text: reply }],
          stopReason: 'end_turn',
          usage: { inputTokens: 1, outputTokens: 1 },
        },
      }
    })

    const lowSystems = createSystems({
      relationship: {
        scheme: 'multi-dim',
        baseline: {
          trust: 0.1,
          affinity: 0.1,
          familiarity: 0.05,
          respect: 0.2,
        },
      },
    })
    const highSystems = createSystems({
      relationship: {
        scheme: 'multi-dim',
        baseline: {
          trust: 0.95,
          affinity: 0.9,
          familiarity: 0.9,
          respect: 0.95,
        },
      },
    })

    const lowEvents = []
    for await (const event of runAgent(
      createConfig(),
      [createTextMessage('user', '继续处理这个任务')],
      provider,
      lowSystems,
    )) {
      lowEvents.push(event)
    }

    resetDb()
    bootstrapRelationshipDb(dbPath)

    const highEvents = []
    for await (const event of runAgent(
      createConfig(),
      [createTextMessage('user', '继续处理这个任务')],
      provider,
      highSystems,
    )) {
      highEvents.push(event)
    }

    const turnPrompts = prompts.filter((prompt) => prompt.includes('当前你与用户的关系状态'))

    assert.equal(turnPrompts.length, 2)
    assert.match(turnPrompts[0] ?? '', /几乎不信任/)
    assert.match(turnPrompts[1] ?? '', /高度信任/)
    assert.deepEqual(lowEvents.at(-1), {
      type: 'complete',
      response: {
        content: [{ type: 'text', text: '我会先谨慎确认你的意图，再继续处理。' }],
        stopReason: 'end_turn',
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    })
    assert.deepEqual(highEvents.at(-1), {
      type: 'complete',
      response: {
        content: [{ type: 'text', text: '当然，我直接帮你把这件事接着做完。' }],
        stopReason: 'end_turn',
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    })
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})
