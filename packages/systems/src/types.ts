export interface PromptFragment {
  source: string
  priority: number
  content: string
}

export interface ConversationBlock {
  type: string
  text?: string
  name?: string
  input?: Record<string, unknown>
  id?: string
  tool_use_id?: string
  content?: string | ConversationBlock[]
  is_error?: boolean
}

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system'
  content: string | ConversationBlock[]
}

export type CompactionReason =
  | {
      type: 'message_count'
      messageCount: number
    }
  | {
      type: 'estimated_tokens'
      messageCount: number
      estimatedTokens: number
    }

export interface PendingCompaction {
  kind: 'summary'
  reason: CompactionReason
  prompt: string
  sourceMessages: ConversationMessage[]
  keepMessages: ConversationMessage[]
}

export interface TurnContext {
  agentId: string
  sessionId: string
  userId: string
  input: {
    raw: string
    text: string
    modality: 'text' | 'image' | 'audio'
    perception?: Record<string, unknown>
  }
  state: Record<string, unknown>
  promptFragments: PromptFragment[]
  messages: ConversationMessage[]
  pendingCompaction?: PendingCompaction
  response?: {
    content: unknown[]
    stopReason: string
    usage: {
      inputTokens: number
      outputTokens: number
    }
  }
}

export type SystemPhase = 'beforeTurn' | 'beforeLLM' | 'afterLLM' | 'afterTurn'

export interface AgentSystem {
  name: string
  type: string
  beforeTurn?(ctx: TurnContext): Promise<void>
  beforeLLM?(ctx: TurnContext): Promise<void>
  afterLLM?(ctx: TurnContext): Promise<void>
  afterTurn?(ctx: TurnContext): Promise<void>
  init?(agentId: string): Promise<void>
  destroy?(): Promise<void>
}

export type AgentModules = Record<string, unknown> | null | undefined
export type SystemFactory = () => AgentSystem
export type SystemRegistry = Record<string, Record<string, SystemFactory>>
