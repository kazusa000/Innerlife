import type { ContentBlock, Message, ToolDefinition } from '../types'

export const PROVIDER_NAMES = ['anthropic', 'openrouter'] as const
export type ProviderName = (typeof PROVIDER_NAMES)[number]

export interface LLMReasoningConfig {
  enabled?: boolean
  effort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
  maxTokens?: number
  exclude?: boolean
}

export interface LLMResponseFormatJsonSchema {
  name: string
  strict?: boolean
  schema: Record<string, unknown>
}

export type LLMResponseFormat =
  | { type: 'json_object' }
  | { type: 'json_schema'; jsonSchema: LLMResponseFormatJsonSchema }

export interface LLMRequest {
  model: string
  systemPrompt: string
  messages: Message[]
  tools?: ToolDefinition[]
  maxTokens?: number
  temperature?: number
  reasoning?: LLMReasoningConfig
  responseFormat?: LLMResponseFormat
  signal?: AbortSignal
}

export interface LLMResponse {
  content: ContentBlock[]
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens'
  usage: { inputTokens: number; outputTokens: number }
}

export type LLMStreamEvent =
  | { type: 'thinking_delta'; text: string }
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use_start'; id: string; name: string }
  | { type: 'tool_use_delta'; id: string; input: string }
  | { type: 'message_complete'; response: LLMResponse }

export interface LLMProvider {
  name: string
  streamMessage(params: LLMRequest): AsyncGenerator<LLMStreamEvent>
  sendMessage(params: LLMRequest): Promise<LLMResponse>
}
