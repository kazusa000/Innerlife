import assert from 'node:assert/strict'
import test from 'node:test'
import { OpenAICompatibleProvider } from './openai-compatible'
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

test('OpenAICompatibleProvider sendMessage maps OpenAI-compatible chat requests without reasoning payload', async () => {
  const seen: { url?: string; headers?: unknown; body?: unknown } = {}

  const fetchImpl = (async (input, init) => {
    seen.url = typeof input === 'string' ? input : input.toString()
    seen.headers = init?.headers
    seen.body = init?.body ? JSON.parse(String(init.body)) : undefined

    return Response.json({
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            content: '先查一下。',
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: {
                  name: 'search_long_term_memory',
                  arguments: '{"query":"星际2"}',
                },
              },
            ],
          },
        },
      ],
      usage: {
        prompt_tokens: 12,
        completion_tokens: 8,
      },
    })
  }) as typeof fetch

  const provider = new OpenAICompatibleProvider('compat-key', 'https://api.example.test/v1', fetchImpl)
  const messages: Message[] = [
    { role: 'user', content: [{ type: 'text', text: '那个游戏叫什么来着？' }] },
    {
      role: 'assistant',
      content: [
        { type: 'text', text: '我查一下记忆。' },
        {
          type: 'tool_use',
          id: 'call_1',
          name: 'search_long_term_memory',
          input: { query: '星际2' },
        },
      ],
    },
    {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'call_1', content: '王家骏喜欢星际争霸2。' },
      ],
    },
  ]

  const response = await provider.sendMessage({
    model: 'gpt-4.1-mini',
    systemPrompt: 'You are helpful.',
    messages,
    reasoning: { enabled: true, effort: 'medium' },
    responseFormat: { type: 'json_object' },
    tools: [
      {
        name: 'search_long_term_memory',
        description: 'Search memory',
        input_schema: {
          type: 'object',
          properties: {
            query: { type: 'string' },
          },
          required: ['query'],
        },
      },
    ],
  })

  assert.equal(seen.url, 'https://api.example.test/v1/chat/completions')
  assert.equal((seen.headers as Headers).get('Authorization'), 'Bearer compat-key')
  assert.equal((seen.body as { model: string }).model, 'gpt-4.1-mini')
  assert.equal('reasoning' in (seen.body as Record<string, unknown>), false)
  assert.deepEqual((seen.body as { response_format?: unknown }).response_format, { type: 'json_object' })
  assert.deepEqual((seen.body as { messages: unknown[] }).messages, [
    { role: 'system', content: 'You are helpful.' },
    { role: 'user', content: '那个游戏叫什么来着？' },
    {
      role: 'assistant',
      content: '我查一下记忆。',
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: {
            name: 'search_long_term_memory',
            arguments: '{"query":"星际2"}',
          },
        },
      ],
    },
    {
      role: 'tool',
      tool_call_id: 'call_1',
      content: '王家骏喜欢星际争霸2。',
    },
  ])
  assert.deepEqual(response, {
    content: [
      { type: 'text', text: '先查一下。' },
      { type: 'tool_use', id: 'call_1', name: 'search_long_term_memory', input: { query: '星际2' } },
    ],
    stopReason: 'tool_use',
    usage: {
      inputTokens: 12,
      outputTokens: 8,
    },
  })
})

test('OpenAICompatibleProvider streamMessage yields text, tool calls, and final usage', async () => {
  const seen: { body?: unknown } = {}
  const fetchImpl = (async (_input, init) => {
    seen.body = init?.body ? JSON.parse(String(init.body)) : undefined

    return createSseResponse([
      'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"好"}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"web_fetch","arguments":""}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"url\\":"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"https://example.com\\"}"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":9,"completion_tokens":4}}\n\n',
      'data: [DONE]\n\n',
    ])
  }) as typeof fetch

  const provider = new OpenAICompatibleProvider(undefined, 'http://localhost:1234/v1', fetchImpl)
  const events = []

  for await (const event of provider.streamMessage({
    model: 'local-model',
    systemPrompt: 'You are helpful.',
    messages: [{ role: 'user', content: [{ type: 'text', text: '你好' }] }],
    reasoning: { enabled: true, effort: 'high' },
  })) {
    events.push(event)
  }

  assert.equal('reasoning' in (seen.body as Record<string, unknown>), false)
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
})
