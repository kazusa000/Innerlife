import type { AgentConfig, AgentEvent } from './types'
import type { LLMProvider, LLMResponse } from '../provider/types'
import type { Message, ContentBlock, TextBlock, ToolDefinition, ToolUseBlock } from '../types'
import { toolsToDefinitions, executeTool } from '../tools/registry'
import { isAbortError, throwIfAborted } from '../utils/abort'
import { COMPACTION_SUMMARY_PREFIX } from '@mas/systems'
import type {
  AgentSystem,
  ConversationBlock,
  ConversationMessage,
  PendingMemoryWrite,
  PendingCompaction,
  SystemPhase,
  TurnContext,
} from '@mas/systems'

export interface RunAgentObserver {
  onLLMCallStart(payload: {
    kind: 'turn' | 'compaction' | 'memory'
    model: string
    systemPrompt: string
    tools: ToolDefinition[]
    messages: Message[]
  }): string

  onLLMCallEnd(callId: string, payload: {
    response: ContentBlock[]
    stopReason: LLMResponse['stopReason']
    usage: { inputTokens: number; outputTokens: number }
    metadata?: Record<string, unknown>
    error?: string
  }): void
}

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

  yield* runSystemPhase(systems, 'beforeTurn', ctx)

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
    ctx.messages = messages
    yield* runSystemPhase(systems, 'beforeLLM', ctx)
    const baseSystemPrompt = composeSystemPrompt(config.systemPrompt, ctx.promptFragments)

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

    const callId = observer?.onLLMCallStart({
      kind: 'turn',
      model: config.model,
      systemPrompt: llmInput.systemPrompt,
      tools: toolDefs,
      messages: [...messages],
    })

    let response: LLMResponse | undefined

    try {
      for await (const event of provider.streamMessage({
        model: config.model,
        systemPrompt: llmInput.systemPrompt,
        messages: llmInput.messages,
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
        metadata: Object.keys(ctx.turnMetadata).length > 0 ? ctx.turnMetadata : undefined,
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
      yield* runSystemPhase(systems, 'afterTurn', ctx)
      const memoryWrite = await runPendingMemoryWrite(
        ctx.pendingMemoryWrite,
        config,
        provider,
        observer,
        signal,
      )
      if (memoryWrite.event) {
        yield memoryWrite.event
      }
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

function createTurnContext(config: AgentConfig, messages: Message[]): TurnContext {
  const lastUserMessage = [...messages].reverse().find((message) => message.role === 'user')
  const inputText = extractUserText(lastUserMessage)

  return {
    agentId: config.id,
    sessionId: config.sessionId ?? 'default-session',
    userId: config.userId ?? 'default-user',
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

function composeSystemPrompt(basePrompt: string, fragments: TurnContext['promptFragments']) {
  if (fragments.length === 0) {
    return basePrompt
  }

  const ordered = [...fragments].sort((a, b) => a.priority - b.priority)
  return [basePrompt, ...ordered.map((fragment) => fragment.content)].join('\n\n')
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

function extractContentText(content: Message['content'] | ConversationMessage['content']): string {
  if (typeof content === 'string') {
    return content
  }

  return content
    .map((block) => {
      if (block.type === 'text' && typeof block.text === 'string') {
        return block.text
      }
      return JSON.stringify(block)
    })
    .join('\n')
}

function cloneMessages(messages: Message[]): Message[] {
  return JSON.parse(JSON.stringify(messages))
}

function createSummaryMessage(summaryText: string): Message {
  return {
    role: 'system',
    content: [
      {
        type: 'text',
        text: [COMPACTION_SUMMARY_PREFIX, summaryText].join('\n'),
      },
    ],
  }
}

async function runPendingCompaction(
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

async function runPendingMemoryWrite(
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
      signal,
    })
    const result = pending.parse(extractContentText(response.content))
    await pending.persist(result)

    if (callId !== undefined && observer) {
      observer.onLLMCallEnd(callId, {
        response: response.content,
        stopReason: response.stopReason,
        usage: response.usage,
        metadata: {
          storedMemory: result,
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
