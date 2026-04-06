import Anthropic from '@anthropic-ai/sdk'
import type { LLMProvider, LLMRequest, LLMResponse, LLMStreamEvent } from './types.js'
import type { ContentBlock } from '../types.js'

export class AnthropicProvider implements LLMProvider {
  name = 'anthropic'
  private client: Anthropic

  constructor(apiKey?: string) {
    this.client = new Anthropic({
      apiKey: apiKey ?? process.env.ANTHROPIC_API_KEY,
    })
  }

  async *streamMessage(params: LLMRequest): AsyncGenerator<LLMStreamEvent> {
    const stream = this.client.messages.stream({
      model: params.model,
      system: params.systemPrompt,
      messages: params.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      tools: params.tools?.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema as Anthropic.Tool.InputSchema,
      })),
      max_tokens: params.maxTokens ?? 4096,
      temperature: params.temperature,
    })

    let currentToolId = ''
    let currentToolName = ''
    let currentToolInput = ''

    for await (const event of stream) {
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
          if (delta.type === 'text_delta') {
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

    const finalMessage = await stream.finalMessage()

    const allBlocks: ContentBlock[] = finalMessage.content.map((block) => {
      if (block.type === 'text') {
        return { type: 'text' as const, text: block.text }
      }
      if (block.type === 'tool_use') {
        return {
          type: 'tool_use' as const,
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        }
      }
      return { type: 'text' as const, text: '' }
    })

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
