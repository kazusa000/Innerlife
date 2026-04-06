import type { Tool, ToolResult } from '../tools/types.js'
import type { LLMResponse } from '../provider/types.js'

export interface AgentConfig {
  id: string
  model: string
  systemPrompt: string
  tools: Tool[]
  maxTurns?: number
}

export type AgentEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_start'; toolName: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolName: string; result: ToolResult }
  | { type: 'complete'; response: LLMResponse }
  | { type: 'error'; error: Error }
