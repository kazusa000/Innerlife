import assert from 'node:assert/strict'
import test from 'node:test'
import { AnthropicProvider } from './anthropic'

function createFakeStream(finalContent: unknown[]) {
  return {
    async *[Symbol.asyncIterator]() {
      yield {
        type: 'content_block_delta',
        delta: { type: 'thinking_delta', thinking: '需要先查记忆。' },
      }
    },
    async finalMessage() {
      return {
        content: finalContent,
        stop_reason: 'tool_use',
        usage: {
          input_tokens: 10,
          output_tokens: 5,
        },
      }
    },
  }
}

test('AnthropicProvider preserves thinking blocks in final content for tool continuations', async () => {
  const provider = new AnthropicProvider('test-key')
  ;(provider as unknown as {
    client: {
      messages: {
        stream: () => ReturnType<typeof createFakeStream>
      }
    }
  }).client = {
    messages: {
      stream: () => createFakeStream([
        {
          type: 'thinking',
          thinking: '需要先查记忆。',
          signature: 'sig-1',
        },
        {
          type: 'text',
          text: '我查一下。',
        },
        {
          type: 'tool_use',
          id: 'tool-1',
          name: 'search_long_term_memory',
          input: { query: '猫' },
        },
      ]),
    },
  }

  const events = []
  for await (const event of provider.streamMessage({
    model: 'claude-sonnet-4-6',
    systemPrompt: 'test',
    messages: [{ role: 'user', content: [{ type: 'text', text: '记得猫吗？' }] }],
    reasoning: { enabled: true, effort: 'medium' },
  })) {
    events.push(event)
  }

  assert.deepEqual(events, [
    { type: 'thinking_delta', text: '需要先查记忆。' },
    {
      type: 'message_complete',
      response: {
        content: [
          {
            type: 'thinking',
            thinking: '需要先查记忆。',
            signature: 'sig-1',
          },
          { type: 'text', text: '我查一下。' },
          {
            type: 'tool_use',
            id: 'tool-1',
            name: 'search_long_term_memory',
            input: { query: '猫' },
          },
        ],
        stopReason: 'tool_use',
        usage: {
          inputTokens: 10,
          outputTokens: 5,
        },
      },
    },
  ])
})

test('AnthropicProvider explicitly disables thinking when reasoning is off', async () => {
  let seenRequest: unknown
  const provider = new AnthropicProvider('test-key')
  ;(provider as unknown as {
    client: {
      messages: {
        stream: (request: unknown) => ReturnType<typeof createFakeStream>
      }
    }
  }).client = {
    messages: {
      stream: (request) => {
        seenRequest = request
        return createFakeStream([{ type: 'text', text: 'done' }])
      },
    },
  }

  for await (const _event of provider.streamMessage({
    model: 'deepseek-chat',
    systemPrompt: 'test',
    messages: [{ role: 'user', content: [{ type: 'text', text: '不要思考' }] }],
    reasoning: { effort: 'none' },
  })) {
    // Drain stream.
  }

  assert.deepEqual(
    (seenRequest as { thinking?: unknown }).thinking,
    { type: 'disabled' },
  )
})
