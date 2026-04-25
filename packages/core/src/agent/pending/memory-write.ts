import type { PendingMemoryWrite } from '@mas/systems'
import type { AgentConfig, AgentEvent, RunAgentObserver } from '../types'
import type { LLMProvider } from '../../provider/types'
import type { Message } from '../../types'
import { cloneMessages, extractContentText } from '../message-utils'

export async function runPendingMemoryWrite(
  pending: PendingMemoryWrite | undefined,
  config: AgentConfig,
  provider: LLMProvider,
  observer?: RunAgentObserver,
  signal?: AbortSignal,
): Promise<{
  event?: Extract<AgentEvent, { type: 'system_error' }>
}> {
  if (!pending) {
    return {}
  }

  const messages: Message[] = [
    {
      role: 'user',
      content: [{ type: 'text', text: pending.sourceText }],
    },
  ]
  const callId = observer?.onLLMCallStart({
    kind: 'memory',
    model: pending.model ?? config.model,
    systemPrompt: pending.prompt,
    tools: [],
    messages: cloneMessages(messages),
  })

  try {
    const response = await provider.sendMessage({
      model: pending.model ?? config.model,
      systemPrompt: pending.prompt,
      messages,
      reasoning: pending.reasoning,
      responseFormat: pending.responseFormat,
      signal,
    })
    const result = pending.parse(extractContentText(response.content))
    const written = await pending.persist(result)

    if (callId !== undefined && observer) {
      observer.onLLMCallEnd(callId, {
        response: response.content,
        stopReason: response.stopReason,
        usage: response.usage,
        metadata: {
          phase: 'summarize',
              written: written
            ? {
                id: written.id,
                summary: written.displaySummary,
                layer: written.layer,
                retrievalText: written.retrievalText,
                tags: [...written.tags],
                importance: written.importance,
              }
            : {
                summary: result.displaySummary,
                layer: 'short_term',
                retrievalText: result.retrievalText,
                tags: [...result.tags],
                importance: result.importance,
              },
        },
      })
    }

    return {}
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
        system: pending.system,
        phase: 'afterTurn',
        error: err,
      },
    }
  }
}
