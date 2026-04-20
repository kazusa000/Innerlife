'use client'

export type LiveCallKind = 'turn' | 'compaction' | 'memory' | 'emotion' | 'relationship'

export interface LiveCall {
  callId: string
  turnIndex: number
  kind: LiveCallKind
  model: string
  systemPrompt: string
  tools: unknown[]
  messages: unknown[]
  metadata?: Record<string, unknown> | null
  response?: unknown
  stopReason?: string | null
  usage?: { inputTokens: number; outputTokens: number } | null
  error?: string | null
  finished: boolean
}

export interface AgentModuleConfig {
  scheme?: string
  [key: string]: unknown
}

export interface AgentModules {
  personality?: AgentModuleConfig | null
  values?: AgentModuleConfig | null
  memory?: AgentModuleConfig | null
  emotion?: AgentModuleConfig | null
  relationship?: AgentModuleConfig | null
  [key: string]: unknown
}

export type ObserverTab = 'main' | 'memory' | 'emotion' | 'relationship'

export interface ObserverTurnState {
  calls: LiveCall[]
  status: 'idle' | 'loading' | 'running' | 'complete' | 'error'
}

export interface ObserverTurnSummaryCall {
  id: string
  turnIndex: number
  kind: LiveCallKind
  stopReason: string | null
  startedAt: number
  finishedAt: number | null
}

export interface ObserverTurnSummary {
  userMessageId: string
  userText: string
  createdAt: number
  calls: ObserverTurnSummaryCall[]
}
