import type { PendingCompaction } from '@mas/systems'
import type { AgentConfig, AgentEvent, RunAgentObserver } from '../types'
import type { LLMProvider } from '../../provider/types'
import type { Message } from '../../types'
import {
  cloneMessages,
  createSummaryMessage,
  extractContentText,
} from '../message-utils'

export async function runPendingCompaction(
  pending: PendingCompaction | undefined,
  config: AgentConfig,
  provider: LLMProvider,
  messages: Message[],
  observer?: RunAgentObserver,
  signal?: AbortSignal,
): Promise<{
  messages?: Message[]
  event?: Extract<AgentEvent, { type: 'system_error' }>
}> {
  if (!pending) {
    return {}
  }

  const beforeMessages = cloneMessages(messages)
  const callId = observer?.onLLMCallStart({
    kind: 'compaction',
    model: config.model,
    systemPrompt: pending.prompt,
    tools: [],
    messages: cloneMessages(pending.sourceMessages as Message[]),
  })

  try {
    const response = await provider.sendMessage({
      model: config.model,
      systemPrompt: pending.prompt,
      messages: pending.sourceMessages as Message[],
      signal,
    })

    const summaryText = extractContentText(response.content)
    if (!summaryText.trim()) {
      throw new Error('Compaction produced an empty summary')
    }

    const nextMessages = [
      createSummaryMessage(summaryText),
      ...(pending.keepMessages as Message[]),
    ]

    if (callId !== undefined && observer) {
      observer.onLLMCallEnd(callId, {
        response: response.content,
        stopReason: response.stopReason,
        usage: response.usage,
        metadata: {
          reason: pending.reason,
          beforeMessageCount: beforeMessages.length,
          afterMessageCount: nextMessages.length,
          summary: summaryText,
          beforeMessages,
          afterMessages: cloneMessages(nextMessages),
        },
      })
    }

    return { messages: nextMessages }
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
        system: 'compaction:summary',
        phase: 'beforeLLM',
        error: err,
      },
    }
  }
}
