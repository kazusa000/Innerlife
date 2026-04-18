import assert from 'node:assert/strict'
import test from 'node:test'
import { runAgent } from './runner'
import type { AgentConfig } from './types'
import type { LLMProvider, LLMRequest, LLMResponse, LLMStreamEvent } from '../provider/types'
import type { Tool } from '../tools/types'
import type { ContentBlock, Message } from '../types'
import { createSystems, type AgentSystem, type TurnContext } from '@mas/systems'

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

test('runAgent composes sorted prompt fragments from systems before calling the provider', async () => {
  const seen: { systemPrompt?: string } = {}

  const provider = new FakeProvider(async function* (params) {
    seen.systemPrompt = params.systemPrompt
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
  assert.equal(seen.systemPrompt, 'test\n\nfirst\n\nsecond\n\nthird')
})

test('runAgent emits system_error and continues when a system hook throws', async () => {
  const provider = new FakeProvider(async function* (params) {
    assert.equal(params.systemPrompt, 'test\n\nstill here')
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
                'Key facts: user is building B5',
                'User preferences: concise replies',
                'Unresolved tasks: finish context compaction',
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
    assert.match(params.systemPrompt, /concise replies/)
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
              'Conversation summary:',
              'Key facts: user is building B5',
              'User preferences: concise replies',
              'Unresolved tasks: finish context compaction',
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
