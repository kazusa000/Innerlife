import { llmCallsRepo } from '@mas/db'
import type { Observer, ObserverEventSink } from './types'

export interface DbObserverOptions {
  sessionId: string
  userMessageId: string
  model: string
  onEvent?: ObserverEventSink
}

export function createDbObserver(opts: DbObserverOptions): Observer {
  let turnIndex = 0

  return {
    onLLMCallStart(payload) {
      const currentTurn = turnIndex++
      const callId = llmCallsRepo.startCall({
        kind: payload.kind,
        sessionId: opts.sessionId,
        userMessageId: opts.userMessageId,
        turnIndex: currentTurn,
        model: payload.model,
        systemPrompt: payload.systemPrompt,
        toolsJson: JSON.stringify(payload.tools),
        messagesJson: JSON.stringify(payload.messages),
        metadataJson: payload.metadata ? JSON.stringify(payload.metadata) : undefined,
      })
      opts.onEvent?.({
        type: 'llm_call_start',
        callId,
        turnIndex: currentTurn,
        payload,
      })
      return callId
    },

    onLLMCallEnd(callId, payload) {
      llmCallsRepo.finishCall(callId, {
        responseJson: JSON.stringify(payload.response),
        stopReason: payload.stopReason,
        inputTokens: payload.usage.inputTokens,
        outputTokens: payload.usage.outputTokens,
        metadataJson: payload.metadata ? JSON.stringify(payload.metadata) : undefined,
        error: payload.error,
      })
      opts.onEvent?.({
        type: 'llm_call_end',
        callId,
        payload,
      })
    },
  }
}
