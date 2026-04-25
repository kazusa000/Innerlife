import {
  applyRelationshipDecayAndDelta,
  parseRelationshipAnalysis,
  serializeRelationshipState,
} from '@mas/systems'
import type {
  PendingRelationshipAnalysis,
  RelationshipAnalysisResult,
} from '@mas/systems'
import type { AgentConfig, AgentEvent, RunAgentObserver } from '../types'
import type { LLMProvider } from '../../provider/types'
import type { Message } from '../../types'
import { cloneMessages, extractContentText } from '../message-utils'

export async function runPendingRelationshipAnalysis(
  pending: PendingRelationshipAnalysis | undefined,
  config: AgentConfig,
  provider: LLMProvider,
  observer?: RunAgentObserver,
  signal?: AbortSignal,
): Promise<{
  analysis?: RelationshipAnalysisResult
  event?: Extract<AgentEvent, { type: 'system_error' }>
}> {
  if (!pending) {
    return {}
  }

  const model = pending.model ?? config.model
  const callId = observer?.onLLMCallStart({
    kind: 'relationship',
    model,
    systemPrompt: pending.systemPrompt,
    tools: [],
    messages: cloneMessages(pending.messages as Message[]),
  })

  try {
    const response = await provider.sendMessage({
      model,
      systemPrompt: pending.systemPrompt,
      messages: pending.messages as Message[],
      reasoning: { effort: 'none' },
      signal,
    })

    const analysis = parseRelationshipAnalysis(extractContentText(response.content))
    const afterState = applyRelationshipDecayAndDelta(
      pending.currentState,
      pending.baseline,
      pending.decayPerTurn,
      analysis.delta,
    )

    if (callId !== undefined && observer) {
      observer.onLLMCallEnd(callId, {
        response: response.content,
        stopReason: response.stopReason,
        usage: response.usage,
        metadata: {
          before: serializeRelationshipState(pending.currentState),
          after: serializeRelationshipState(afterState),
          delta: serializeRelationshipState(analysis.delta),
          trigger: analysis.trigger,
          counterpartId: pending.counterpart?.id ?? null,
          counterpartName: pending.counterpart?.name ?? null,
          counterpartType: pending.counterpart?.type ?? null,
        },
      })
    }

    return { analysis }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))

    if (callId !== undefined && observer) {
      observer.onLLMCallEnd(callId, {
        response: [],
        stopReason: 'end_turn',
        usage: { inputTokens: 0, outputTokens: 0 },
        error: err.message,
      })
    }

    return {
      event: {
        type: 'system_error',
        system: `relationship:${pending.kind}`,
        phase: 'afterLLM',
        error: err,
      },
    }
  }
}
