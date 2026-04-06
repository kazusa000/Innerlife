import type { AgentConfig, AgentEvent } from './types'
import type { LLMProvider, LLMResponse } from '../provider/types'
import type { Message, ContentBlock, ToolUseBlock } from '../types'
import { toolsToDefinitions, executeTool } from '../tools/registry'

export async function* runAgent(
  config: AgentConfig,
  messages: Message[],
  provider: LLMProvider,
): AsyncGenerator<AgentEvent> {
  const maxTurns = config.maxTurns ?? 20
  let turns = 0

  while (true) {
    if (++turns > maxTurns) {
      yield { type: 'error', error: new Error(`Max turns (${maxTurns}) exceeded`) }
      return
    }

    let response: LLMResponse | undefined

    try {
      for await (const event of provider.streamMessage({
        model: config.model,
        systemPrompt: config.systemPrompt,
        messages,
        tools: toolsToDefinitions(config.tools),
      })) {
        if (event.type === 'text_delta') {
          yield { type: 'text_delta', text: event.text }
        } else if (event.type === 'message_complete') {
          response = event.response
        }
      }
    } catch (err) {
      yield { type: 'error', error: err instanceof Error ? err : new Error(String(err)) }
      return
    }

    if (!response) {
      yield { type: 'error', error: new Error('No response from LLM') }
      return
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
      yield { type: 'tool_start', toolName: toolCall.name, input: toolCall.input }
      const result = await executeTool(config.tools, toolCall)
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
