export type TuringStageId =
  | 'natural_opening'
  | 'daily_flow'
  | 'memory_recall'
  | 'memory_humanness'
  | 'emotional_plausibility'
  | 'relationship_boundaries'
  | 'uncertainty_and_leaks'

export type TuringRunStatus =
  | 'queued'
  | 'preparing'
  | 'running'
  | 'interrupting'
  | 'interrupted'
  | 'completed'
  | 'failed'
  | 'cleaned'

export interface TuringSuiteInjection {
  type: 'context' | 'memory' | 'emotion' | 'relationship'
  label: string
  payload: Record<string, unknown>
}

export interface TuringSuiteTurn {
  message: string
  label: string
}

export interface TuringStageDefinition {
  id: TuringStageId
  title: string
  purpose: string
  injections: TuringSuiteInjection[]
  turns: TuringSuiteTurn[]
}

export interface TuringJudgeEvaluation {
  stageId: TuringStageId
  summary: string
  status: 'pass' | 'warning' | 'abort'
  failure: string | null
  suggestion: string | null
  evidence: string | null
  scores: {
    naturalness: number
    continuity: number
    recall: number
    emotion: number
    relationship: number
  }
}

export interface TuringReport {
  verdict: 'pass' | 'fail'
  summary: string
  scores: {
    naturalness: number
    continuity: number
    recall: number
    emotion: number
    relationship: number
  }
  failures: string[]
  suggestions: string[]
  abort?: {
    stageId: TuringStageId
    reason: string
    evidence: string
  } | null
}

export interface TuringTranscriptTurn {
  stageId: TuringStageId
  role: 'judge' | 'agent' | 'system'
  message: string
  createdAt: string
  meta?: Record<string, unknown>
}

export interface TuringRunDetail {
  id: string
  sourceAgentId: string
  tempAgentId: string | null
  tempSessionId: string | null
  status: TuringRunStatus
  currentStage: TuringStageId | null
  abortReason: string | null
  report: TuringReport | null
  transcript: TuringTranscriptTurn[] | null
  error: string | null
}
