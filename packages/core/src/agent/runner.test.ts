import assert from 'node:assert/strict'
import test from 'node:test'
import { runAgent } from './runner'
import type { AgentConfig } from './types'
import type { LLMProvider, LLMRequest, LLMResponse, LLMStreamEvent } from '../provider/types'
import type { Tool } from '../tools/types'

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
