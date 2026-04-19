'use client'

export interface LiveCall {
  callId: string
  turnIndex: number
  kind?: 'turn' | 'compaction' | 'memory' | 'emotion'
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
