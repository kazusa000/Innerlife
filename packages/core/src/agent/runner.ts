import type { AgentConfig, AgentEvent, RunAgentObserver } from './types'
import type { LLMProvider, LLMReasoningConfig, LLMResponse } from '../provider/types'
import type { Message, TextBlock, ToolUseBlock, ContentBlock } from '../types'
import { toolsToDefinitions, executeTool } from '../tools/registry'
import { isAbortError, throwIfAborted } from '../utils/abort'
import type {
  AgentSystem,
  SystemPhase,
  TurnContext,
} from '@mas/systems'
import { runPendingCompaction } from './pending/compaction'
import { runPendingEmotionAnalysis } from './pending/emotion-analysis'
import { runPendingMemoryQuery } from './pending/memory-query'
import { runPendingMemoryWrite } from './pending/memory-write'
import { runPendingRelationshipAnalysis } from './pending/relationship-analysis'
import { cloneMessages, extractContentText } from './message-utils'

export type { RunAgentObserver } from './types'

export async function* runAgent(
  config: AgentConfig,
  messages: Message[],
  provider: LLMProvider,
  systems: AgentSystem[] = [],
  observer?: RunAgentObserver,
  signal?: AbortSignal,
): AsyncGenerator<AgentEvent> {
  const maxTurns = config.maxTurns ?? 20
  let turns = 0
  const ctx = createTurnContext(config, messages)
  const exposeThinking = isReasoningEnabled(config.reasoning)

  yield* runSystemPhase(systems, 'beforeTurn', ctx)
  const memoryQuery = await runPendingMemoryQuery(
    ctx.pendingMemoryQuery,
    ctx,
    config,
    provider,
    observer,
    signal,
  )
  if (memoryQuery.event) {
    yield memoryQuery.event
  }

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
    ctx.promptFragments = []
    ctx.pendingCompaction = undefined
    ctx.pendingMemoryQuery = undefined
    ctx.pendingEmotionAnalysis = undefined
    ctx.pendingRelationshipAnalysis = undefined
    ctx.emotionAnalysis = undefined
    ctx.relationshipAnalysis = undefined
    ctx.messages = messages
    yield* runSystemPhase(systems, 'beforeLLM', ctx)
    const baseSystemPrompt = composeSystemPrompt(config.systemPrompt, ctx.promptFragments, config.locale)
    const promptFragmentMetadata = buildPromptFragmentMetadata(ctx.promptFragments)

    const compaction = await runPendingCompaction(
      ctx.pendingCompaction,
      config,
      provider,
      messages,
      observer,
      signal,
    )

    if (compaction.event) {
      yield compaction.event
    }

    if (compaction.messages) {
      messages = compaction.messages
      ctx.messages = messages
    }

    const llmInput = prepareLLMInput(baseSystemPrompt, messages)
    const systemPrompt = appendThinkingRoleImmersionPrompt(
      llmInput.systemPrompt,
      config.reasoning,
      config.thinkingRoleImmersionPrompt,
    )

    const callId = observer?.onLLMCallStart({
      kind: 'turn',
      model: config.model,
      systemPrompt,
      tools: toolDefs,
      messages: [...messages],
      metadata: promptFragmentMetadata,
    })

    let response: LLMResponse | undefined
    let thinkingText = ''

    try {
      for await (const event of provider.streamMessage({
        model: config.model,
        systemPrompt,
        messages: llmInput.messages,
        tools: toolDefs,
        reasoning: config.reasoning ?? { effort: 'none' },
        signal,
      })) {
        throwIfAborted(signal)

        if (event.type === 'thinking_delta') {
          if (exposeThinking) {
            thinkingText += event.text
            yield { type: 'thinking_delta', text: event.text }
          }
        } else if (event.type === 'text_delta') {
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
        metadata: mergeObserverMetadata(
          promptFragmentMetadata,
          thinkingText ? { thinking: { text: thinkingText } } : undefined,
          Object.keys(ctx.turnMetadata).length > 0 ? ctx.turnMetadata : undefined,
        ),
      })
    }

    messages.push({ role: 'assistant', content: response.content })
    ctx.response = {
      content: response.content,
      stopReason: response.stopReason,
      usage: response.usage,
    }
    yield* runSystemPhase(systems, 'afterLLM', ctx)

    if (response.stopReason !== 'tool_use') {
      ctx.pendingMemoryWrite = undefined

      yield* runSystemPhase(selectSystemsByType(systems, 'memory'), 'afterTurn', ctx)

      const [emotion, relationship, memoryWrite] = await Promise.all([
        runPendingEmotionAnalysis(
          ctx.pendingEmotionAnalysis,
          config,
          provider,
          observer,
          signal,
        ),
        runPendingRelationshipAnalysis(
          ctx.pendingRelationshipAnalysis,
          config,
          provider,
          observer,
          signal,
        ),
        runPendingMemoryWrite(
          ctx.pendingMemoryWrite,
          config,
          provider,
          observer,
          signal,
        ),
      ])

      if (emotion.analysis) {
        ctx.emotionAnalysis = emotion.analysis
      }

      if (relationship.analysis) {
        ctx.relationshipAnalysis = relationship.analysis
      }

      if (emotion.event) {
        yield emotion.event
      }

      if (relationship.event) {
        yield relationship.event
      }

      if (memoryWrite.event) {
        yield memoryWrite.event
      }

      yield* runSystemPhase(rejectSystemsByType(systems, 'memory'), 'afterTurn', ctx)
      yield { type: 'complete', response }
      return
    }

    const toolUses = response.content.filter(
      (b): b is ToolUseBlock => b.type === 'tool_use',
    )

    const toolResults: ContentBlock[] = []
    const postToolSystemMessages: Message[] = []
    let longTermSearchCalls = 0

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
        if (toolCall.name === 'search_long_term_memory') {
          longTermSearchCalls += 1
          if (longTermSearchCalls > 1) {
            result = {
              output: config.locale === 'en-US'
                ? 'Long-term memory search: no relevant memory found.'
                : '长期记忆检索结果：未搜索到相关记忆。',
              isError: true,
              metadata: { noResults: true, reason: 'too_many_calls' },
            }
          } else {
            result = await executeTool(config.tools, toolCall, {
              signal,
              agentId: config.id,
              sessionId: config.sessionId,
              provider,
              memoryRetrievalQuery:
                typeof ctx.state.memoryRetrievalQuery === 'string'
                  ? ctx.state.memoryRetrievalQuery
                  : null,
              recentMessages: cloneMessages(messages),
              locale: config.locale,
            })
          }
        } else {
          result = await executeTool(config.tools, toolCall, {
            signal,
            agentId: config.id,
            sessionId: config.sessionId,
            provider,
            memoryRetrievalQuery:
              typeof ctx.state.memoryRetrievalQuery === 'string'
                ? ctx.state.memoryRetrievalQuery
                : null,
            recentMessages: cloneMessages(messages),
            locale: config.locale,
          })
        }
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
        metadata: result.metadata,
      })

      if (toolCall.name === 'search_long_term_memory' && result.metadata?.noResults) {
        postToolSystemMessages.push({
          role: 'system',
          content: config.locale === 'en-US'
            ? 'Long-term memory search: no relevant memory found.'
            : '长期记忆检索结果：未搜索到相关记忆。',
        })
      }
    }

    messages.push({ role: 'user', content: toolResults })
    if (postToolSystemMessages.length > 0) {
      messages.push(...postToolSystemMessages)
    }
  }
}

function createTurnContext(config: AgentConfig, messages: Message[]): TurnContext {
  const lastUserMessage = [...messages].reverse().find((message) => message.role === 'user')
  const inputText = extractUserText(lastUserMessage)

  return {
    agentId: config.id,
    sessionId: config.sessionId ?? 'default-session',
    userId: config.userId ?? 'default-user',
    locale: config.locale ?? 'zh-CN',
    input: {
      raw: inputText,
      text: inputText,
      modality: 'text',
    },
    state: {},
    turnMetadata: {},
    promptFragments: [],
    messages,
  }
}

function extractUserText(message?: Message): string {
  if (!message) {
    return ''
  }

  if (typeof message.content === 'string') {
    return message.content
  }

  return message.content
    .filter((block): block is TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
}

function formatCurrentLocalDateTime(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  const timezoneOffsetMinutes = -date.getTimezoneOffset()
  const sign = timezoneOffsetMinutes >= 0 ? '+' : '-'
  const absoluteMinutes = Math.abs(timezoneOffsetMinutes)
  const tzHours = String(Math.floor(absoluteMinutes / 60)).padStart(2, '0')
  const tzMinutes = String(absoluteMinutes % 60).padStart(2, '0')
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds} ${sign}${tzHours}:${tzMinutes}`
}

function composeSystemPrompt(basePrompt: string, fragments: TurnContext['promptFragments'], locale: AgentConfig['locale'] = 'zh-CN') {
  const timePrompt = locale === 'en-US'
    ? `Current local time: ${formatCurrentLocalDateTime()}`
    : `当前本地时间：${formatCurrentLocalDateTime()}`
  const ordered = [...fragments].sort((a, b) => a.priority - b.priority)
  return [basePrompt, timePrompt, ...ordered.map((fragment) => fragment.content)].join('\n\n')
}

function normalizePromptFragmentSource(source: string): string {
  const [prefix] = source.split(':')
  return ['personality', 'emotion', 'memory', 'relationship'].includes(prefix)
    ? prefix
    : source
}

function serializePromptFragments(fragments: TurnContext['promptFragments']) {
  return [...fragments]
    .sort((a, b) => a.priority - b.priority)
    .map((fragment) => ({
      source: normalizePromptFragmentSource(fragment.source),
      priority: fragment.priority,
      content: fragment.content,
    }))
}

function buildPromptFragmentMetadata(
  fragments: TurnContext['promptFragments'],
): Record<string, unknown> | undefined {
  const serialized = serializePromptFragments(fragments)
  return serialized.length > 0
    ? { fragments: serialized }
    : undefined
}

function mergeObserverMetadata(
  ...records: Array<Record<string, unknown> | undefined>
): Record<string, unknown> | undefined {
  const merged = records.reduce<Record<string, unknown>>((result, record) => {
    if (record) {
      Object.assign(result, record)
    }
    return result
  }, {})

  return Object.keys(merged).length > 0 ? merged : undefined
}

function isReasoningEnabled(reasoning?: LLMReasoningConfig) {
  return Boolean(
    reasoning?.enabled
    || (reasoning?.effort && reasoning.effort !== 'none')
    || reasoning?.maxTokens,
  )
}

function appendThinkingRoleImmersionPrompt(
  systemPrompt: string,
  reasoning?: LLMReasoningConfig,
  prompt?: string,
) {
  const trimmedPrompt = prompt?.trim()
  return isReasoningEnabled(reasoning) && trimmedPrompt
    ? [systemPrompt, trimmedPrompt].filter(Boolean).join('\n\n')
    : systemPrompt
}

function prepareLLMInput(basePrompt: string, messages: Message[]) {
  const systemMessages = messages.filter((message) => message.role === 'system')
  const systemPromptParts = [
    basePrompt,
    ...systemMessages
      .map((message) => extractContentText(message.content))
      .filter(Boolean),
  ]

  return {
    systemPrompt: systemPromptParts.join('\n\n'),
    messages: messages.filter(
      (message): message is Message & { role: 'user' | 'assistant' } => message.role !== 'system',
    ),
  }
}


async function* runSystemPhase(
  systems: AgentSystem[],
  phase: SystemPhase,
  ctx: TurnContext,
): AsyncGenerator<AgentEvent> {
  const settled = await Promise.all(
    systems.map(async (system) => {
      const hook = system[phase]
      if (!hook) {
        return null
      }

      try {
        await hook.call(system, ctx)
        return null
      } catch (error) {
        return {
          type: 'system_error' as const,
          system: system.name,
          phase,
          error: error instanceof Error ? error : new Error(String(error)),
        }
      }
    }),
  )

  for (const result of settled) {
    if (result) {
      yield result
    }
  }
}

function selectSystemsByType(systems: AgentSystem[], type: AgentSystem['type']): AgentSystem[] {
  return systems.filter((system) => system.type === type)
}

function rejectSystemsByType(systems: AgentSystem[], type: AgentSystem['type']): AgentSystem[] {
  return systems.filter((system) => system.type !== type)
}
