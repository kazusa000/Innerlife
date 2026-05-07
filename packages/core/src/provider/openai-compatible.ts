import type {
  LLMProvider,
  LLMRequest,
  LLMResponse,
  LLMStreamEvent,
} from './types'
import { throwIfAborted } from '../utils/abort'
import {
  buildOpenRouterMessages,
  buildResponse,
  mapResponseFormat,
  mapTools,
  type OpenRouterUsage,
  type StreamingToolState,
} from './openrouter'

interface OpenAICompatibleChoice {
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

interface OpenAICompatibleResponse {
  choices?: OpenAICompatibleChoice[]
  usage?: OpenRouterUsage
  error?: { message?: string }
}

const DEFAULT_BASE_URL = 'https://api.openai.com/v1'

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value ? value : undefined
}

async function readErrorResponse(response: Response): Promise<never> {
  const text = await response.text()
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string }; message?: string }
    const message = parsed.error?.message ?? parsed.message ?? text
    throw new Error(message || `OpenAI-compatible request failed: ${response.status}`)
  } catch {
    throw new Error(text || `OpenAI-compatible request failed: ${response.status}`)
  }
}

export class OpenAICompatibleProvider implements LLMProvider {
  name = 'openai-compatible'

  constructor(
    private readonly apiKey = readEnv('OPENAI_COMPATIBLE_API_KEY'),
    private readonly baseURL = readEnv('OPENAI_COMPATIBLE_BASE_URL') ?? DEFAULT_BASE_URL,
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
        response_format: mapResponseFormat(params.responseFormat),
        stream: true,
      }),
      signal: params.signal,
    })

    if (!response.ok) {
      await readErrorResponse(response)
    }

    if (!response.body) {
      throw new Error('No response body received from OpenAI-compatible provider')
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

        const payload = JSON.parse(data) as OpenAICompatibleResponse
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
        response_format: mapResponseFormat(params.responseFormat),
        stream: false,
      }),
      signal: params.signal,
    })

    if (!response.ok) {
      await readErrorResponse(response)
    }

    const payload = await response.json() as OpenAICompatibleResponse
    if (payload.error?.message) {
      throw new Error(payload.error.message)
    }

    const choice = payload.choices?.[0]
    if (!choice?.message) {
      throw new Error('No response received from OpenAI-compatible provider')
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
