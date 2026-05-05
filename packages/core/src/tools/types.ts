import type { LLMProvider } from '../provider/types'
import type { Message } from '../types'

export interface ToolResult {
  output: string
  isError?: boolean
  metadata?: Record<string, unknown>
}

export type BuiltInToolName = 'search_long_term_memory' | 'web_fetch'

export interface AgentToolConfig {
  enabled?: boolean
  description?: string
  episodicActivation?: {
    enabled?: boolean
    ttlMinutes?: number
    maxActive?: number
  }
}

export type AgentToolsConfig = Partial<Record<BuiltInToolName, AgentToolConfig>>

export interface ToolCallOptions {
  signal?: AbortSignal
  agentId?: string
  sessionId?: string
  memoryRetrievalQuery?: string | null
  recentMessages?: Message[]
  provider?: Pick<LLMProvider, 'sendMessage'>
}

export interface Tool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  call(input: Record<string, unknown>, options?: ToolCallOptions): Promise<ToolResult>
  isEnabled?(): boolean
}
