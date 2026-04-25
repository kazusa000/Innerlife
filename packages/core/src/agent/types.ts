import type { Tool, ToolResult } from '../tools/types'
import type { LLMResponse } from '../provider/types'
import type { SystemPhase } from '@mas/systems'
import type { Message, ContentBlock, ToolDefinition } from '../types'

export interface AgentConfig {
  id: string
  model: string
  systemPrompt: string
  tools: Tool[]
  maxTurns?: number
  sessionId?: string
  userId?: string
}

export type AgentEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_start'; toolName: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolName: string; result: ToolResult }
  | { type: 'system_error'; system: string; phase: SystemPhase; error: Error }
  | { type: 'complete'; response: LLMResponse }
  | { type: 'aborted' }
  | { type: 'error'; error: Error }

export interface RunAgentObserver {
  onLLMCallStart(payload: {
    kind: 'turn' | 'compaction' | 'memory' | 'emotion' | 'relationship'
    model: string
    systemPrompt: string
    tools: ToolDefinition[]
    messages: Message[]
    metadata?: Record<string, unknown>
  }): string

  onLLMCallEnd(callId: string, payload: {
    response: ContentBlock[]
    stopReason: LLMResponse['stopReason']
    usage: { inputTokens: number; outputTokens: number }
    metadata?: Record<string, unknown>
    error?: string
  }): void
}
