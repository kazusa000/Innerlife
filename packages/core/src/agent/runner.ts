import type { AgentConfig, AgentEvent } from './types'
import type { LLMProvider, LLMResponse } from '../provider/types'
import type { Message, ContentBlock, TextBlock, ToolDefinition, ToolUseBlock } from '../types'
import { toolsToDefinitions, executeTool } from '../tools/registry'
import { isAbortError, throwIfAborted } from '../utils/abort'
import {
  COMPACTION_SUMMARY_PREFIX,
  applyDecayAndDelta,
  applyRelationshipDecayAndDelta,
} from '@mas/systems'
import type {
  AgentSystem,
  ConversationBlock,
  ConversationMessage,
  EmotionAnalysisResult,
  PendingCompaction,
  PendingEmotionAnalysis,
  PendingMemoryQuery,
  PendingMemoryWrite,
  PendingRelationshipAnalysis,
  RelationshipAnalysisResult,
  SystemPhase,
  TurnContext,
} from '@mas/systems'

export interface RunAgentObserver {
  onLLMCallStart(payload: {
    kind: 'turn' | 'compaction' | 'memory' | 'emotion' | 'relationship'
    model: string
    systemPrompt: string
    tools: ToolDefinition[]
    messages: Message[]
    metadata?: Record<string, unknown>
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
    const baseSystemPrompt = composeSystemPrompt(config.systemPrompt, ctx.promptFragments)
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

    const callId = observer?.onLLMCallStart({
      kind: 'turn',
      model: config.model,
      systemPrompt: llmInput.systemPrompt,
      tools: toolDefs,
      messages: [...messages],
      metadata: promptFragmentMetadata,
    })

    let response: LLMResponse | undefined

    try {
      for await (const event of provider.streamMessage({
        model: config.model,
        systemPrompt: llmInput.systemPrompt,
        messages: llmInput.messages,
        tools: toolDefs,
        reasoning: { effort: 'none' },
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
        metadata: mergeObserverMetadata(
          promptFragmentMetadata,
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
                retrievalText: written.retrievalText,
                tags: [...written.tags],
                importance: written.importance,
              }
            : {
                summary: result.displaySummary,
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

async function runPendingMemoryQuery(
  pending: PendingMemoryQuery | undefined,
  ctx: TurnContext,
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
      content: [{ type: 'text', text: pending.inputText }],
    },
  ]
  const callId = observer?.onLLMCallStart({
    kind: 'memory',
    model: pending.model ?? config.model,
    systemPrompt: pending.prompt,
    tools: [],
    messages: cloneMessages(messages),
  })

  let response: LLMResponse | undefined
  let queryError: Error | undefined
  let retrieveError: Error | undefined
  let query = {
    retrievalQuery: null as PendingMemoryQuery['parse'] extends (responseText: string) => infer T
      ? T extends { retrievalQuery: infer R }
        ? R
        : null
      : null,
    timeRange: null as PendingMemoryQuery['parse'] extends (responseText: string) => infer T
      ? T extends { timeRange: infer R }
        ? R
        : null
      : null,
    focus: null as PendingMemoryQuery['parse'] extends (responseText: string) => infer T
      ? T extends { focus: infer F }
        ? F
        : null
      : null,
  }
  let memories: NonNullable<TurnContext['state']['memories']> = []

  try {
    response = await provider.sendMessage({
      model: pending.model ?? config.model,
      systemPrompt: pending.prompt,
      messages,
      reasoning: pending.reasoning,
      responseFormat: pending.responseFormat,
      signal,
    })
    query = pending.parse(extractContentText(response.content))
  } catch (err) {
    queryError = err instanceof Error ? err : new Error(String(err))
  }

  ctx.state.memoryRetrievalQuery = query.retrievalQuery
  ctx.state.memoryRetrievalTimeRange = query.timeRange
  ctx.state.memories = []

  if (!queryError && (query.retrievalQuery || query.timeRange)) {
    try {
      memories = await pending.retrieve(query)
      ctx.state.memories = memories
      const hits = memories.map((memory) => serializeMemoryHit(memory))
      ctx.turnMetadata.memory = {
        hitCount: memories.length,
        retrievalQuery: query.retrievalQuery,
        focus: query.focus,
        timeRange: query.timeRange
          ? {
              start: query.timeRange.start.toISOString(),
              end: query.timeRange.end.toISOString(),
            }
          : null,
        memoryIds: memories.map((memory) => memory.id),
        hits,
      }
    } catch (err) {
      retrieveError = err instanceof Error ? err : new Error(String(err))
    }
  }

  const error =
    queryError && retrieveError
      ? new Error(`${queryError.message}; memory retrieve failed: ${retrieveError.message}`)
      : queryError ?? retrieveError
  const metadata: Record<string, unknown> = {
    phase: 'retrieve',
    retrievalQuery: query.retrievalQuery,
    focus: query.focus,
    timeRange: query.timeRange
      ? {
          start: query.timeRange.start.toISOString(),
          end: query.timeRange.end.toISOString(),
        }
      : null,
  }

  if (!queryError && (query.retrievalQuery || query.timeRange)) {
    const hits = memories.map((memory) => serializeMemoryHit(memory))
    metadata.hitCount = memories.length
    metadata.memoryIds = memories.map((memory) => memory.id)
    metadata.hits = hits
  }

  if (callId !== undefined && observer) {
    observer.onLLMCallEnd(callId, {
      response: response?.content ?? [],
      stopReason: response?.stopReason ?? 'end_turn',
      usage: response?.usage ?? { inputTokens: 0, outputTokens: 0 },
      metadata,
      error: error?.message,
    })
  }

  if (!error) {
    return {}
  }

  return {
    event: {
      type: 'system_error',
      system: pending.system,
      phase: 'beforeTurn',
      error,
    },
  }
}

function clampSigned(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 0
  }

  return Math.min(1, Math.max(-1, value))
}

function parseEmotionAnalysis(rawResponse: string): EmotionAnalysisResult {
  const trimmed = rawResponse.trim()
  const withoutFence = trimmed.startsWith('```')
    ? trimmed
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim()
    : trimmed
  const record = JSON.parse(withoutFence) as {
    mood_delta?: unknown
    energy_delta?: unknown
    stress_delta?: unknown
    trigger?: unknown
  }

  return {
    delta: {
      mood: clampSigned(record.mood_delta),
      energy: clampSigned(record.energy_delta),
      stress: clampSigned(record.stress_delta),
    },
    trigger:
      typeof record.trigger === 'string' && record.trigger.trim()
        ? record.trigger.trim()
        : null,
    rawResponse: withoutFence,
  }
}

function parseRelationshipAnalysis(rawResponse: string): RelationshipAnalysisResult {
  const trimmed = rawResponse.trim()
  const withoutFence = trimmed.startsWith('```')
    ? trimmed
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim()
    : trimmed
  const record = JSON.parse(withoutFence) as {
    trust_delta?: unknown
    affinity_delta?: unknown
    familiarity_delta?: unknown
    respect_delta?: unknown
    trigger?: unknown
  }

  return {
    delta: {
      trust: clampSigned(record.trust_delta),
      affinity: clampSigned(record.affinity_delta),
      familiarity: clampSigned(record.familiarity_delta),
      respect: clampSigned(record.respect_delta),
    },
    trigger:
      typeof record.trigger === 'string' && record.trigger.trim()
        ? record.trigger.trim()
        : null,
    rawResponse: withoutFence,
  }
}

function serializeEmotionState(state: PendingEmotionAnalysis['currentState']) {
  const round = (value: number) => Number(value.toFixed(3))

  return {
    mood: round(state.mood),
    energy: round(state.energy),
    stress: round(state.stress),
  }
}

function serializeRelationshipState(state: PendingRelationshipAnalysis['currentState']) {
  const round = (value: number) => Number(value.toFixed(3))

  return {
    trust: round(state.trust),
    affinity: round(state.affinity),
    familiarity: round(state.familiarity),
    respect: round(state.respect),
  }
}

function serializeMemoryHit(memory: NonNullable<TurnContext['state']['memories']>[number]) {
  return {
    id: memory.id,
    summary: memory.displaySummary,
    tags: [...memory.tags],
    importance: memory.importance,
  }
}

async function runPendingEmotionAnalysis(
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

async function runPendingRelationshipAnalysis(
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
        system: 'relationship:multi-dim',
        phase: 'afterLLM',
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

function selectSystemsByType(systems: AgentSystem[], type: AgentSystem['type']): AgentSystem[] {
  return systems.filter((system) => system.type === type)
}

function rejectSystemsByType(systems: AgentSystem[], type: AgentSystem['type']): AgentSystem[] {
  return systems.filter((system) => system.type !== type)
}
