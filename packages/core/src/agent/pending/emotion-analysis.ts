import {
  applyDecayAndDelta,
  parseEmotionAnalysis,
  serializeEmotionState,
} from '@mas/systems'
import type { EmotionAnalysisResult, PendingEmotionAnalysis } from '@mas/systems'
import type { AgentConfig, AgentEvent, RunAgentObserver } from '../types'
import type { LLMProvider } from '../../provider/types'
import type { Message } from '../../types'
import { cloneMessages, extractContentText } from '../message-utils'

export async function runPendingEmotionAnalysis(
  pending: PendingEmotionAnalysis | undefined,
  config: AgentConfig,
  provider: LLMProvider,
  observer?: RunAgentObserver,
  signal?: AbortSignal,
): Promise<{
  analysis?: EmotionAnalysisResult
  event?: Extract<AgentEvent, { type: 'system_error' }>
}> {
  if (!pending) {
    return {}
  }

  const model = pending.model ?? config.model
  const callId = observer?.onLLMCallStart({
    kind: 'emotion',
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

    const analysis = parseEmotionAnalysis(extractContentText(response.content))
    const afterState = applyDecayAndDelta(
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
          before: serializeEmotionState(pending.currentState),
          after: serializeEmotionState(afterState),
          delta: serializeEmotionState(analysis.delta),
          trigger: analysis.trigger,
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
        system: 'emotion:dimensional',
        phase: 'afterLLM',
        error: err,
      },
    }
  }
}
