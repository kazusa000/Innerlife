import type { ContentBlock, Message, ToolDefinition } from '../types'

export const PROVIDER_NAMES = ['anthropic', 'openrouter'] as const
export type ProviderName = (typeof PROVIDER_NAMES)[number]

export interface LLMRequest {
  model: string
  systemPrompt: string
  messages: Message[]
  tools?: ToolDefinition[]
  maxTokens?: number
  temperature?: number
  signal?: AbortSignal
}

export interface LLMResponse {
  content: ContentBlock[]
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens'
  usage: { inputTokens: number; outputTokens: number }
}

export type LLMStreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use_start'; id: string; name: string }
  | { type: 'tool_use_delta'; id: string; input: string }
  | { type: 'message_complete'; response: LLMResponse }

export interface LLMProvider {
  name: string
  streamMessage(params: LLMRequest): AsyncGenerator<LLMStreamEvent>
  sendMessage(params: LLMRequest): Promise<LLMResponse>
}
