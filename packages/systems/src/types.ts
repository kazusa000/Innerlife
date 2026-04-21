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

export interface MemoryRecord {
  id: string
  agentId: string
  sessionId: string
  layer: 'short_term' | 'long_term' | 'fixed'
  sourceText: string
  displaySummary: string
  retrievalText: string
  retrievalEmbedding: number[]
  retrievalModel: string
  tags: string[]
  importance: number
  createdAt: Date
}

export interface MemoryWriteResult {
  displaySummary: string
  retrievalText: string
  tags: string[]
  importance: number
}

export interface MemoryTimeRange {
  start: Date
  end: Date
}

export interface MemoryReasoningConfig {
  enabled?: boolean
  effort?: 'none' | 'low' | 'medium' | 'high'
}

export type MemoryResponseFormat =
  | { type: 'json_object' }
  | {
      type: 'json_schema'
      jsonSchema: {
        name: string
        strict?: boolean
        schema: Record<string, unknown>
      }
    }

export interface MemoryQueryResult {
  retrievalQuery: string | null
  timeRange: MemoryTimeRange | null
  focus: string | null
}

export interface PendingMemoryWrite {
  kind: 'sqlite'
  system: string
  model?: string | null
  reasoning?: MemoryReasoningConfig
  responseFormat?: MemoryResponseFormat
  prompt: string
  sourceText: string
  parse(responseText: string): MemoryWriteResult
  persist(result: MemoryWriteResult): Promise<MemoryRecord | void> | MemoryRecord | void
}

export interface PendingMemoryQuery {
  kind: 'sqlite'
  system: string
  model?: string | null
  reasoning?: MemoryReasoningConfig
  responseFormat?: MemoryResponseFormat
  prompt: string
  inputText: string
  parse(responseText: string): MemoryQueryResult
  retrieve(query: MemoryQueryResult): Promise<MemoryRecord[]> | MemoryRecord[]
}

export interface EmotionStateVector {
  mood: number
  energy: number
  stress: number
}

export interface PendingEmotionAnalysis {
  kind: 'dimensional'
  model?: string | null
  systemPrompt: string
  messages: ConversationMessage[]
  currentState: EmotionStateVector
  baseline: EmotionStateVector
  decayPerTurn: number
}

export interface EmotionAnalysisResult {
  delta: EmotionStateVector
  trigger: string | null
  rawResponse: string
}

export interface RelationshipDimensions {
  trust: number
  affinity: number
  familiarity: number
  respect: number
}

export interface RelationshipHistoryEntry {
  summary: string
  trigger: string | null
  delta: {
    trust: number
    affinity: number
    familiarity: number
    respect: number
  }
  createdAt: string
}

export interface PendingRelationshipAnalysis {
  kind: 'multi-dim'
  model?: string | null
  systemPrompt: string
  messages: ConversationMessage[]
  currentState: RelationshipDimensions
  baseline: RelationshipDimensions
  decayPerTurn: number
}

export interface RelationshipAnalysisResult {
  delta: {
    trust: number
    affinity: number
    familiarity: number
    respect: number
  }
  trigger: string | null
  rawResponse: string
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
  state: {
    memories?: MemoryRecord[]
    [key: string]: unknown
  }
  turnMetadata: Record<string, unknown>
  promptFragments: PromptFragment[]
  messages: ConversationMessage[]
  pendingCompaction?: PendingCompaction
  pendingMemoryQuery?: PendingMemoryQuery
  pendingMemoryWrite?: PendingMemoryWrite
  pendingEmotionAnalysis?: PendingEmotionAnalysis
  pendingRelationshipAnalysis?: PendingRelationshipAnalysis
  emotionAnalysis?: EmotionAnalysisResult
  relationshipAnalysis?: RelationshipAnalysisResult
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
export type SystemFactory = (config?: unknown) => AgentSystem
export type SystemRegistry = Record<string, Record<string, SystemFactory>>
