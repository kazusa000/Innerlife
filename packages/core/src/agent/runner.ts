import type { AgentConfig, AgentEvent } from './types'
import type { LLMProvider, LLMResponse } from '../provider/types'
import type { Message, ContentBlock, ToolDefinition, ToolUseBlock } from '../types'
import { toolsToDefinitions, executeTool } from '../tools/registry'
import { isAbortError, throwIfAborted } from '../utils/abort'

export interface RunAgentObserver {
  onLLMCallStart(payload: {
    model: string
    systemPrompt: string
    tools: ToolDefinition[]
    messages: Message[]
  }): string

  onLLMCallEnd(callId: string, payload: {
    response: ContentBlock[]
    stopReason: LLMResponse['stopReason']
    usage: { inputTokens: number; outputTokens: number }
    error?: string
  }): void
}

export async function* runAgent(
  config: AgentConfig,
  messages: Message[],
  provider: LLMProvider,
  observer?: RunAgentObserver,
  signal?: AbortSignal,
): AsyncGenerator<AgentEvent> {
  const maxTurns = config.maxTurns ?? 20
  let turns = 0

  while (true) {
    try {
      throwIfAborted(signal)
    } catch {
      yield { type: 'aborted' }
      return
    }

    if (++turns > maxTurns) {
      yield { type: 'error', error: new Error(`Max turns (${maxTurns}) exceeded`) }
      return
    }

    const toolDefs = toolsToDefinitions(config.tools)

    const callId = observer?.onLLMCallStart({
      model: config.model,
      systemPrompt: config.systemPrompt,
      tools: toolDefs,
      messages: [...messages],
    })

    let response: LLMResponse | undefined

    try {
      for await (const event of provider.streamMessage({
        model: config.model,
        systemPrompt: config.systemPrompt,
        messages,
        tools: toolDefs,
        signal,
      })) {
        throwIfAborted(signal)

        if (event.type === 'text_delta') {
          yield { type: 'text_delta', text: event.text }
        } else if (event.type === 'message_complete') {
          response = event.response
        }
      }
    } catch (err) {
      if (isAbortError(err)) {
        const abortError = err instanceof Error ? err : new Error(String(err))
        if (callId !== undefined && observer) {
          observer.onLLMCallEnd(callId, {
            response: [],
            stopReason: 'end_turn',
            usage: { inputTokens: 0, outputTokens: 0 },
            error: abortError.message,
          })
        }
        yield { type: 'aborted' }
        return
      }

      const error = err instanceof Error ? err : new Error(String(err))
      if (callId !== undefined && observer) {
        observer.onLLMCallEnd(callId, {
          response: [],
          stopReason: 'end_turn',
          usage: { inputTokens: 0, outputTokens: 0 },
          error: error.message,
        })
      }
      yield { type: 'error', error }
      return
    }

    if (!response) {
      const error = new Error('No response from LLM')
      if (callId !== undefined && observer) {
        observer.onLLMCallEnd(callId, {
          response: [],
          stopReason: 'end_turn',
          usage: { inputTokens: 0, outputTokens: 0 },
          error: error.message,
        })
      }
      yield { type: 'error', error }
      return
    }

    if (callId !== undefined && observer) {
      observer.onLLMCallEnd(callId, {
        response: response.content,
        stopReason: response.stopReason,
        usage: response.usage,
      })
    }

    messages.push({ role: 'assistant', content: response.content })

    if (response.stopReason !== 'tool_use') {
      yield { type: 'complete', response }
      return
    }

    const toolUses = response.content.filter(
      (b): b is ToolUseBlock => b.type === 'tool_use',
    )

    const toolResults: ContentBlock[] = []

    for (const toolCall of toolUses) {
      try {
        throwIfAborted(signal)
      } catch {
        yield { type: 'aborted' }
        return
      }

      yield { type: 'tool_start', toolName: toolCall.name, input: toolCall.input }
      let result
      try {
        result = await executeTool(config.tools, toolCall, { signal })
      } catch (err) {
        if (isAbortError(err)) {
          yield { type: 'aborted' }
          return
        }
        throw err
      }
      yield { type: 'tool_result', toolName: toolCall.name, result }

      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolCall.id,
        content: result.output,
        is_error: result.isError,
      })
    }

    messages.push({ role: 'user', content: toolResults })
  }
}
