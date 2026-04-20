import type { ContentBlock, Message, ToolDefinition } from '../types'
import type { LLMProvider, LLMRequest, LLMResponse, LLMStreamEvent } from './types'
import { throwIfAborted } from '../utils/abort'

type OpenRouterRole = 'system' | 'user' | 'assistant' | 'tool'

interface OpenRouterToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

interface OpenRouterChatMessage {
  role: OpenRouterRole
  content?: string | null
  tool_calls?: OpenRouterToolCall[]
  tool_call_id?: string
}

interface OpenRouterChoice {
  finish_reason?: string | null
  message?: {
    content?: string | null
    tool_calls?: Array<{
      id?: string
      type?: string
      function?: {
        name?: string
        arguments?: string
      }
    }>
  }
  delta?: {
    content?: string | null
    tool_calls?: Array<{
      index?: number
      id?: string
      function?: {
        name?: string
        arguments?: string
      }
    }>
  }
}

interface OpenRouterUsage {
  prompt_tokens?: number
  completion_tokens?: number
}

interface OpenRouterResponse {
  choices?: OpenRouterChoice[]
  usage?: OpenRouterUsage
  error?: { message?: string }
}

interface StreamingToolState {
  id: string
  name: string
  input: string
  started: boolean
}

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1'

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value ? value : undefined
}

function parseJsonObject(text: string): Record<string, unknown> {
  try {
    const value = JSON.parse(text)
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function buildOpenRouterMessages(systemPrompt: string, messages: Message[]): OpenRouterChatMessage[] {
  const result: OpenRouterChatMessage[] = []

  if (systemPrompt.trim()) {
    result.push({ role: 'system', content: systemPrompt })
  }

  for (const message of messages) {
    if (typeof message.content === 'string') {
      result.push({ role: message.role, content: message.content })
      continue
    }

    const textContent = message.content
      .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim()

    if (message.role === 'assistant') {
      const toolCalls = message.content
        .filter((block): block is Extract<ContentBlock, { type: 'tool_use' }> => block.type === 'tool_use')
        .map((block) => ({
          id: block.id,
          type: 'function' as const,
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input ?? {}),
          },
        }))

      if (textContent || toolCalls.length > 0) {
        result.push({
          role: 'assistant',
          content: textContent || null,
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        })
      }
      continue
    }

    if (message.role === 'user' && textContent) {
      result.push({ role: 'user', content: textContent })
    }

    const toolResults = message.content
      .filter((block): block is Extract<ContentBlock, { type: 'tool_result' }> => block.type === 'tool_result')

    for (const block of toolResults) {
      result.push({
        role: 'tool',
        tool_call_id: block.tool_use_id,
        content: block.content,
      })
    }
  }

  return result
}

function mapTools(tools?: ToolDefinition[]) {
  return tools?.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }))
}

function mapUsage(usage?: OpenRouterUsage) {
  return {
    inputTokens: usage?.prompt_tokens ?? 0,
    outputTokens: usage?.completion_tokens ?? 0,
  }
}

function mapFinishReason(reason?: string | null): LLMResponse['stopReason'] {
  switch (reason) {
    case 'tool_calls':
      return 'tool_use'
    case 'length':
      return 'max_tokens'
    case 'stop':
    default:
      return 'end_turn'
  }
}

function buildResponse(
  text: string,
  toolCalls: StreamingToolState[],
  finishReason?: string | null,
  usage?: OpenRouterUsage,
): LLMResponse {
  const content: ContentBlock[] = []

  if (text) {
    content.push({ type: 'text', text })
  }

  for (const toolCall of toolCalls) {
    content.push({
      type: 'tool_use',
      id: toolCall.id,
      name: toolCall.name,
      input: parseJsonObject(toolCall.input),
    })
  }

  return {
    content,
    stopReason: mapFinishReason(finishReason),
    usage: mapUsage(usage),
  }
}

async function readErrorResponse(response: Response): Promise<never> {
  const text = await response.text()
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string }; message?: string }
    const message = parsed.error?.message ?? parsed.message ?? text
    throw new Error(message || `OpenRouter request failed: ${response.status}`)
  } catch {
    throw new Error(text || `OpenRouter request failed: ${response.status}`)
  }
}

export class OpenRouterProvider implements LLMProvider {
  name = 'openrouter'

  constructor(
    private readonly apiKey = readEnv('OPENROUTER_API_KEY'),
    private readonly baseURL = readEnv('OPENROUTER_BASE_URL') ?? DEFAULT_BASE_URL,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private buildHeaders() {
    const headers = new Headers({
      'Content-Type': 'application/json',
    })

    const apiKey = this.apiKey?.trim()
    if (apiKey) {
      headers.set('Authorization', `Bearer ${apiKey}`)
    }

    const referer = readEnv('OPENROUTER_HTTP_REFERER') ?? readEnv('OPENROUTER_SITE_URL')
    const title = readEnv('OPENROUTER_TITLE') ?? readEnv('OPENROUTER_SITE_NAME')

    if (referer) {
      headers.set('HTTP-Referer', referer)
    }

    if (title) {
      headers.set('X-OpenRouter-Title', title)
    }

    return headers
  }

  async *streamMessage(params: LLMRequest): AsyncGenerator<LLMStreamEvent> {
    throwIfAborted(params.signal)

    const response = await this.fetchImpl(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify({
        model: params.model,
        messages: buildOpenRouterMessages(params.systemPrompt, params.messages),
        tools: mapTools(params.tools),
        max_tokens: params.maxTokens ?? 4096,
        temperature: params.temperature,
        reasoning: params.reasoning,
        stream: true,
      }),
      signal: params.signal,
    })

    if (!response.ok) {
      await readErrorResponse(response)
    }

    if (!response.body) {
      throw new Error('No response body received from OpenRouter')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    const toolCalls: StreamingToolState[] = []
    let buffer = ''
    let fullText = ''
    let finishReason: string | null | undefined
    let usage: OpenRouterUsage | undefined

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      throwIfAborted(params.signal)
      buffer += decoder.decode(value, { stream: true })

      while (true) {
        const delimiterIndex = buffer.indexOf('\n\n')
        if (delimiterIndex === -1) {
          break
        }

        const rawEvent = buffer.slice(0, delimiterIndex)
        buffer = buffer.slice(delimiterIndex + 2)

        const data = rawEvent
          .split('\n')
          .filter((line) => line.startsWith('data: '))
          .map((line) => line.slice(6))
          .join('\n')
          .trim()

        if (!data || data === '[DONE]') {
          continue
        }

        const payload = JSON.parse(data) as OpenRouterResponse
        if (payload.error?.message) {
          throw new Error(payload.error.message)
        }

        if (payload.usage) {
          usage = payload.usage
        }

        const choice = payload.choices?.[0]
        if (!choice) {
          continue
        }

        if (choice.delta?.content) {
          fullText += choice.delta.content
          yield { type: 'text_delta', text: choice.delta.content }
        }

        for (const toolDelta of choice.delta?.tool_calls ?? []) {
          const index = toolDelta.index ?? 0
          const current = toolCalls[index] ?? {
            id: toolDelta.id ?? '',
            name: toolDelta.function?.name ?? '',
            input: '',
            started: false,
          }

          current.id = toolDelta.id ?? current.id
          current.name = toolDelta.function?.name ?? current.name

          if (!current.started && current.id && current.name) {
            current.started = true
            yield { type: 'tool_use_start', id: current.id, name: current.name }
          }

          if (toolDelta.function?.arguments) {
            current.input += toolDelta.function.arguments
            yield {
              type: 'tool_use_delta',
              id: current.id || `tool_call_${index}`,
              input: toolDelta.function.arguments,
            }
          }

          toolCalls[index] = current
        }

        if (choice.finish_reason) {
          finishReason = choice.finish_reason
        }
      }
    }

    yield {
      type: 'message_complete',
      response: buildResponse(fullText, toolCalls, finishReason, usage),
    }
  }

  async sendMessage(params: LLMRequest): Promise<LLMResponse> {
    throwIfAborted(params.signal)

    const response = await this.fetchImpl(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify({
        model: params.model,
        messages: buildOpenRouterMessages(params.systemPrompt, params.messages),
        tools: mapTools(params.tools),
        max_tokens: params.maxTokens ?? 4096,
        temperature: params.temperature,
        reasoning: params.reasoning,
        stream: false,
      }),
      signal: params.signal,
    })

    if (!response.ok) {
      await readErrorResponse(response)
    }

    const payload = await response.json() as OpenRouterResponse
    if (payload.error?.message) {
      throw new Error(payload.error.message)
    }

    const choice = payload.choices?.[0]
    if (!choice?.message) {
      throw new Error('No response received from OpenRouter')
    }

    const toolCalls = (choice.message.tool_calls ?? []).map((toolCall) => ({
      id: toolCall.id ?? '',
      name: toolCall.function?.name ?? '',
      input: toolCall.function?.arguments ?? '{}',
      started: true,
    }))

    return buildResponse(choice.message.content ?? '', toolCalls, choice.finish_reason, payload.usage)
  }
}
