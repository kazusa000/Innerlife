import Anthropic from '@anthropic-ai/sdk'
import type { LLMProvider, LLMRequest, LLMResponse, LLMStreamEvent } from './types'
import type { ContentBlock } from '../types'
import { throwIfAborted } from '../utils/abort'

function isReasoningEnabled(reasoning?: LLMRequest['reasoning']) {
  return Boolean(reasoning?.enabled || (reasoning?.effort && reasoning.effort !== 'none') || reasoning?.maxTokens)
}

function mapAnthropicEffort(reasoning?: LLMRequest['reasoning']) {
  const effort = reasoning?.effort
  return effort && effort !== 'none' && effort !== 'minimal' ? effort : undefined
}

function buildAnthropicThinking(model: string, reasoning?: LLMRequest['reasoning']) {
  if (!reasoning) {
    return undefined
  }

  if (!isReasoningEnabled(reasoning)) {
    return { type: 'disabled' }
  }

  if (model.includes('4-6') || model.includes('4-7') || model.includes('mythos')) {
    return { type: 'adaptive', display: 'summarized' }
  }

  const budgetTokens = reasoning?.maxTokens
    ?? (reasoning?.effort === 'high' || reasoning?.effort === 'xhigh'
      ? 3072
      : reasoning?.effort === 'medium'
        ? 2048
        : 1024)
  return { type: 'enabled', budget_tokens: budgetTokens, display: 'summarized' }
}

export class AnthropicProvider implements LLMProvider {
  name = 'anthropic'
  private client: Anthropic

  constructor(apiKey?: string, baseURL?: string) {
    this.client = new Anthropic({
      apiKey: apiKey ?? process.env.ANTHROPIC_API_KEY,
      baseURL: baseURL ?? process.env.ANTHROPIC_BASE_URL,
    })
  }

  async *streamMessage(params: LLMRequest): AsyncGenerator<LLMStreamEvent> {
    throwIfAborted(params.signal)

    const request = {
      model: params.model,
      system: params.systemPrompt,
      messages: params.messages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      tools: params.tools?.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema as Anthropic.Tool.InputSchema,
      })),
      max_tokens: params.maxTokens ?? 4096,
      temperature: isReasoningEnabled(params.reasoning) ? undefined : params.temperature,
      thinking: buildAnthropicThinking(params.model, params.reasoning),
      output_config: mapAnthropicEffort(params.reasoning)
        ? { effort: mapAnthropicEffort(params.reasoning) }
        : undefined,
    } as Anthropic.MessageCreateParams

    const stream = this.client.messages.stream(request, {
      signal: params.signal,
    })

    let currentToolId = ''
    let currentToolName = ''
    let currentToolInput = ''

    for await (const event of stream) {
      throwIfAborted(params.signal)

      switch (event.type) {
        case 'content_block_start': {
          const block = event.content_block
          if (block.type === 'tool_use') {
            currentToolId = block.id
            currentToolName = block.name
            currentToolInput = ''
            yield { type: 'tool_use_start', id: block.id, name: block.name }
          }
          break
        }
        case 'content_block_delta': {
          const delta = event.delta
          if (delta.type === 'thinking_delta') {
            yield { type: 'thinking_delta', text: delta.thinking }
          } else if (delta.type === 'text_delta') {
            yield { type: 'text_delta', text: delta.text }
          } else if (delta.type === 'input_json_delta') {
            currentToolInput += delta.partial_json
            yield { type: 'tool_use_delta', id: currentToolId, input: delta.partial_json }
          }
          break
        }
        case 'content_block_stop': {
          if (currentToolName) {
            currentToolName = ''
          }
          break
        }
        case 'message_stop': {
          break
        }
      }
    }

    throwIfAborted(params.signal)
    const finalMessage = await stream.finalMessage()

    const allBlocks: ContentBlock[] = []
    for (const block of finalMessage.content) {
      if (block.type === 'thinking') {
        const thinkingBlock = block as typeof block & { thinking?: string; signature?: string }
        allBlocks.push({
          type: 'thinking',
          thinking: thinkingBlock.thinking ?? '',
          signature: thinkingBlock.signature,
        })
        continue
      }
      if (block.type === 'text') {
        allBlocks.push({ type: 'text', text: block.text })
        continue
      }
      if (block.type === 'tool_use') {
        allBlocks.push({
          type: 'tool_use' as const,
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        })
      }
    }

    const response: LLMResponse = {
      content: allBlocks,
      stopReason: finalMessage.stop_reason as LLMResponse['stopReason'],
      usage: {
        inputTokens: finalMessage.usage.input_tokens,
        outputTokens: finalMessage.usage.output_tokens,
      },
    }

    yield { type: 'message_complete', response }
  }

  async sendMessage(params: LLMRequest): Promise<LLMResponse> {
    let result: LLMResponse | undefined
    for await (const event of this.streamMessage(params)) {
      if (event.type === 'message_complete') {
        result = event.response
      }
    }
    if (!result) throw new Error('No response received from Anthropic')
    return result
  }
}
