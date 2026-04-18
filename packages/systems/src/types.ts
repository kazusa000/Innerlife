export interface PromptFragment {
  source: string
  priority: number
  content: string
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
