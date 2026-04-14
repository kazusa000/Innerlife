import type { Message, ToolDefinition, ContentBlock, LLMResponse } from '@mas/core'

export interface LLMCallStartPayload {
  model: string
  systemPrompt: string
  tools: ToolDefinition[]
  messages: Message[]
}

export interface LLMCallEndPayload {
  response: ContentBlock[]
  stopReason: LLMResponse['stopReason']
  usage: { inputTokens: number; outputTokens: number }
  error?: string
}

export interface Observer {
  onLLMCallStart(payload: LLMCallStartPayload): string
  onLLMCallEnd(callId: string, payload: LLMCallEndPayload): void
}

export interface ObserverEvent {
  type: 'llm_call_start' | 'llm_call_end'
  callId: string
  turnIndex?: number
  payload: LLMCallStartPayload | LLMCallEndPayload
}

export type ObserverEventSink = (event: ObserverEvent) => void
