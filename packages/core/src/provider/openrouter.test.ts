import assert from 'node:assert/strict'
import test from 'node:test'
import { OpenRouterProvider } from './openrouter'
import type { Message } from '../types'

function createSseResponse(events: string[]) {
  const encoder = new TextEncoder()
  return new Response(new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(event))
      }
      controller.close()
    },
  }), {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
    },
  })
}

test('OpenRouterProvider sendMessage maps tool transcripts and parses tool calls', async () => {
  const seen: { url?: string; headers?: unknown; body?: unknown } = {}
  const originalFetch = globalThis.fetch

  globalThis.fetch = (async (input, init) => {
    seen.url = typeof input === 'string' ? input : input.toString()
    seen.headers = init?.headers
    seen.body = init?.body ? JSON.parse(String(init.body)) : undefined

    return Response.json({
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            content: '先看一下网页内容。',
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: {
                  name: 'web_fetch',
                  arguments: '{"url":"https://example.com"}',
                },
              },
            ],
          },
        },
      ],
      usage: {
        prompt_tokens: 11,
        completion_tokens: 7,
      },
    })
  }) as typeof fetch

  try {
    const provider = new OpenRouterProvider('or-key', 'https://openrouter.ai/api/v1')
    const messages: Message[] = [
      {
        role: 'user',
        content: [{ type: 'text', text: '抓一下 example.com' }],
      },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: '我来抓取。' },
          { type: 'tool_use', id: 'call_1', name: 'web_fetch', input: { url: 'https://example.com' } },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'call_1', content: 'Example Domain' },
        ],
      },
    ]

    const response = await provider.sendMessage({
      model: 'openai/gpt-4.1-mini',
      systemPrompt: 'You are helpful.',
      messages,
      reasoning: { effort: 'none' },
      responseFormat: {
        type: 'json_schema',
        jsonSchema: {
          name: 'memory_query',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              retrieval_query: { type: ['string', 'null'] },
            },
            required: ['retrieval_query'],
            additionalProperties: false,
          },
        },
      },
      tools: [
        {
          name: 'web_fetch',
          description: 'Fetch a web page',
          input_schema: {
            type: 'object',
            properties: {
              url: { type: 'string' },
            },
            required: ['url'],
          },
        },
      ],
    })

    assert.equal(seen.url, 'https://openrouter.ai/api/v1/chat/completions')
    assert.equal((seen.body as { model: string }).model, 'openai/gpt-4.1-mini')
    assert.deepEqual((seen.body as { reasoning?: unknown }).reasoning, { effort: 'none' })
    assert.deepEqual((seen.body as { response_format?: unknown }).response_format, {
      type: 'json_schema',
      json_schema: {
        name: 'memory_query',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            retrieval_query: { type: ['string', 'null'] },
          },
          required: ['retrieval_query'],
          additionalProperties: false,
        },
      },
    })
    assert.deepEqual((seen.body as { messages: unknown[] }).messages, [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: '抓一下 example.com' },
      {
        role: 'assistant',
        content: '我来抓取。',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: {
              name: 'web_fetch',
              arguments: '{"url":"https://example.com"}',
            },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'call_1',
        content: 'Example Domain',
      },
    ])
    assert.deepEqual(response, {
      content: [
        { type: 'text', text: '先看一下网页内容。' },
        { type: 'tool_use', id: 'call_1', name: 'web_fetch', input: { url: 'https://example.com' } },
      ],
      stopReason: 'tool_use',
      usage: {
        inputTokens: 11,
        outputTokens: 7,
      },
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('OpenRouterProvider streamMessage yields text deltas, tool deltas, and final usage', async () => {
  const originalFetch = globalThis.fetch
  const seen: { body?: unknown } = {}

  globalThis.fetch = (async (_input, init) => {
    seen.body = init?.body ? JSON.parse(String(init.body)) : undefined

    return createSseResponse([
      ': OPENROUTER PROCESSING\n\n',
      'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"好"}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"web_fetch","arguments":""}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"url\\":"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"https://example.com\\"}"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":9,"completion_tokens":4}}\n\n',
      'data: [DONE]\n\n',
    ])
  }) as typeof fetch

  try {
    const provider = new OpenRouterProvider('or-key', 'https://openrouter.ai/api/v1')
    const events = []

    for await (const event of provider.streamMessage({
      model: 'openai/gpt-4.1-mini',
      systemPrompt: 'You are helpful.',
      messages: [{ role: 'user', content: [{ type: 'text', text: '你好' }] }],
      reasoning: { effort: 'none' },
    })) {
      events.push(event)
    }

    assert.deepEqual((seen.body as { reasoning?: unknown }).reasoning, { effort: 'none' })
    assert.deepEqual(events, [
      { type: 'text_delta', text: '你' },
      { type: 'text_delta', text: '好' },
      { type: 'tool_use_start', id: 'call_1', name: 'web_fetch' },
      { type: 'tool_use_delta', id: 'call_1', input: '{"url":' },
      { type: 'tool_use_delta', id: 'call_1', input: '"https://example.com"}' },
      {
        type: 'message_complete',
        response: {
          content: [
            { type: 'text', text: '你好' },
            { type: 'tool_use', id: 'call_1', name: 'web_fetch', input: { url: 'https://example.com' } },
          ],
          stopReason: 'tool_use',
          usage: {
            inputTokens: 9,
            outputTokens: 4,
          },
        },
      },
    ])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('OpenRouterProvider streamMessage emits reasoning deltas', async () => {
  const originalFetch = globalThis.fetch

  globalThis.fetch = (async () => {
    return createSseResponse([
      'data: {"choices":[{"delta":{"reasoning":"先分析。"}}]}\n\n',
      'data: {"choices":[{"delta":{"reasoning_details":[{"type":"reasoning.summary","summary":"再总结。","format":"anthropic-claude-v1","index":0}]}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"答案"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":4}}\n\n',
      'data: [DONE]\n\n',
    ])
  }) as typeof fetch

  try {
    const provider = new OpenRouterProvider('or-key', 'https://openrouter.ai/api/v1')
    const events = []

    for await (const event of provider.streamMessage({
      model: 'openai/gpt-5.2',
      systemPrompt: 'You are helpful.',
      messages: [{ role: 'user', content: [{ type: 'text', text: '想一下' }] }],
      reasoning: { enabled: true, effort: 'medium' },
    })) {
      events.push(event)
    }

    assert.deepEqual(events, [
      { type: 'thinking_delta', text: '先分析。' },
      { type: 'thinking_delta', text: '再总结。' },
      { type: 'text_delta', text: '答案' },
      {
        type: 'message_complete',
        response: {
          content: [{ type: 'text', text: '答案' }],
          stopReason: 'end_turn',
          usage: {
            inputTokens: 3,
            outputTokens: 4,
          },
        },
      },
    ])
  } finally {
    globalThis.fetch = originalFetch
  }
})
