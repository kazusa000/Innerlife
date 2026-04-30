import { serializeMemoryHit } from '@mas/systems'
import type {
  EntityMention,
  MemoryResponseFormat,
  MemorySemanticAnalysisResult,
  PendingMemoryQuery,
  TurnContext,
} from '@mas/systems'
import type { AgentConfig, AgentEvent, RunAgentObserver } from '../types'
import type { LLMProvider, LLMResponse } from '../../provider/types'
import type { Message } from '../../types'
import { cloneMessages, extractContentText } from '../message-utils'

function serializeEpisodicHit(memory: unknown) {
  if (!memory || typeof memory !== 'object' || Array.isArray(memory)) {
    return null
  }
  const record = memory as { id?: unknown; summary?: unknown; importance?: unknown }
  return {
    id: typeof record.id === 'string' ? record.id : '',
    summary: typeof record.summary === 'string' ? record.summary : '',
    importance: typeof record.importance === 'number' ? record.importance : 0,
  }
}

export async function runPendingMemoryQuery(
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

  if (pending.semanticAnalyzer.kind !== 'llm') {
    return {
      event: {
        type: 'system_error',
        system: pending.system,
        phase: 'beforeTurn',
        error: new Error('Memory semantic analyzer must be llm'),
      },
    }
  }

  const observerPayload = {
    systemPrompt: pending.semanticAnalyzer.prompt,
    messages: [
      {
        role: 'user' as const,
        content: [{ type: 'text' as const, text: `semantic analyzer 输入\n${pending.semanticAnalyzer.inputText}` }],
      },
    ] satisfies Message[],
  }
  const callId = observer?.onLLMCallStart({
    kind: 'memory',
    model: pending.model ?? config.model,
    systemPrompt: observerPayload.systemPrompt,
    tools: [],
    messages: cloneMessages(observerPayload.messages),
  })

  let semanticResponse: LLMResponse | undefined
  let timeError: Error | undefined
  let semanticError: Error | undefined
  let entityMentionError: Error | undefined
  let queryError: Error | undefined
  let retrieveError: Error | undefined
  const timeAnalyzer = pending.timeAnalyzer
  const semanticAnalyzer = pending.semanticAnalyzer
  const entityMentionAnalyzer = pending.entityMentionAnalyzer
  let timeResult = { timeRange: null as null | { start: Date; end: Date } }
  let semanticResult: MemorySemanticAnalysisResult = {
    retrievalQuery: null as string | null,
  }
  let entityMentions: EntityMention[] = []
  let query = { retrievalQuery: null as string | null, timeRange: null as null | { start: Date; end: Date } }
  let memoryResult = {
    shortTerm: [] as NonNullable<TurnContext['state']['shortTermMemories']>,
    fixed: [] as NonNullable<TurnContext['state']['fixedMemories']>,
  }

  const runLlmAnalyzer = async <T,>(
    prompt: string,
    inputText: string,
    responseFormat: MemoryResponseFormat | undefined,
    parse: (responseText: string) => T,
  ) => {
    const response = await provider.sendMessage({
      model: pending.model ?? config.model,
      systemPrompt: prompt,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: inputText }],
        },
      ],
      reasoning: pending.reasoning,
      responseFormat,
      signal,
    })
    return {
      response,
      parsed: parse(extractContentText(response.content)),
    }
  }

  const [timeOutcome, semanticOutcome, entityMentionOutcome] = await Promise.all([
    (timeAnalyzer.kind === 'local'
      ? Promise.resolve().then(async () => ({ parsed: await timeAnalyzer.analyze() }))
      : Promise.reject(new Error('Memory time analyzer must be local')))
      .catch((err) => ({ error: err instanceof Error ? err : new Error(String(err)) })),
    runLlmAnalyzer(
      semanticAnalyzer.prompt,
      semanticAnalyzer.inputText,
      semanticAnalyzer.responseFormat,
      semanticAnalyzer.parse,
    ).catch((err) => ({ error: err instanceof Error ? err : new Error(String(err)) })),
    (entityMentionAnalyzer
      ? (
          entityMentionAnalyzer.kind === 'llm'
            ? runLlmAnalyzer(
                entityMentionAnalyzer.prompt,
                entityMentionAnalyzer.inputText,
                entityMentionAnalyzer.responseFormat,
                entityMentionAnalyzer.parse,
              )
            : Promise.resolve().then(async () => ({ parsed: await entityMentionAnalyzer.analyze() }))
        )
      : Promise.resolve({ parsed: [] as EntityMention[] }))
      .catch((err) => ({ error: err instanceof Error ? err : new Error(String(err)) })),
  ])

  if ('error' in timeOutcome) {
    timeError = timeOutcome.error
  } else {
    timeResult = timeOutcome.parsed
  }

  if ('error' in semanticOutcome) {
    semanticError = semanticOutcome.error
  } else {
    semanticResponse = 'response' in semanticOutcome ? semanticOutcome.response : undefined
    semanticResult = semanticOutcome.parsed
  }

  if ('error' in entityMentionOutcome) {
    entityMentionError = entityMentionOutcome.error
  } else {
    entityMentions = Array.isArray(entityMentionOutcome.parsed)
      ? entityMentionOutcome.parsed as EntityMention[]
      : []
  }

  try {
    query = pending.merge({
      time: timeError ? null : timeResult,
      semantic: semanticResult,
    })
  } catch (err) {
    queryError = err instanceof Error ? err : new Error(String(err))
  }

  ctx.state.memoryRetrievalQuery = query.retrievalQuery
  ctx.state.memoryRetrievalTimeRange = query.timeRange
  ctx.state.memories = []
  ctx.state.shortTermMemories = []
  ctx.state.fixedMemories = []
  ctx.state.episodicMemories = []

  if (pending.activateAndRecallEpisodic && entityMentions.length > 0) {
    try {
      ctx.state.episodicMemories = await pending.activateAndRecallEpisodic(entityMentions)
    } catch (err) {
      entityMentionError = err instanceof Error ? err : new Error(String(err))
    }
  }
  const episodicHits = (ctx.state.episodicMemories ?? [])
    .map(serializeEpisodicHit)
    .filter((hit): hit is { id: string; summary: string; importance: number } => Boolean(hit?.id))
  const includeEntityMentionMetadata = Boolean(entityMentionAnalyzer)
    || entityMentions.length > 0
    || Boolean(entityMentionError)
    || episodicHits.length > 0
  const entityMentionMetadata = includeEntityMentionMetadata
    ? {
        entityMentionAnalyzer: {
          mode: entityMentionAnalyzer?.kind ?? null,
          mentionCount: entityMentions.length,
          error: entityMentionError?.message ?? null,
        },
        episodicHitCount: episodicHits.length,
        episodicMemoryIds: episodicHits.map((memory) => memory.id),
        episodicHits,
      }
    : {}

  if (query.retrievalQuery || query.timeRange) {
    try {
      memoryResult = await pending.retrieve(query)
      ctx.state.shortTermMemories = memoryResult.shortTerm
      ctx.state.fixedMemories = memoryResult.fixed
      ctx.state.memories = [...memoryResult.shortTerm, ...memoryResult.fixed]
      const shortTermHits = memoryResult.shortTerm.map((memory) => serializeMemoryHit(memory))
      const fixedHits = memoryResult.fixed.map((memory) => serializeMemoryHit(memory))
      const hits = [...shortTermHits, ...fixedHits]
      ctx.turnMetadata.memory = {
        hitCount: hits.length,
        timeAnalyzer: {
          timeRange: query.timeRange
            ? {
                start: query.timeRange.start.toISOString(),
                end: query.timeRange.end.toISOString(),
              }
            : null,
          error: timeError?.message ?? null,
        },
        semanticAnalyzer: {
          mode: 'llm',
          retrievalQuery: query.retrievalQuery,
          inputPreview: semanticAnalyzer.inputText,
          error: semanticError?.message ?? null,
        },
        mergedQuery: {
          retrievalQuery: query.retrievalQuery,
          timeRange: query.timeRange
            ? {
                start: query.timeRange.start.toISOString(),
                end: query.timeRange.end.toISOString(),
              }
            : null,
        },
        retrievalQuery: query.retrievalQuery,
        timeRange: query.timeRange
          ? {
              start: query.timeRange.start.toISOString(),
              end: query.timeRange.end.toISOString(),
            }
          : null,
        shortTermHitCount: memoryResult.shortTerm.length,
        fixedHitCount: memoryResult.fixed.length,
        shortTermMemoryIds: memoryResult.shortTerm.map((memory) => memory.id),
        fixedMemoryIds: memoryResult.fixed.map((memory) => memory.id),
        shortTermHits,
        fixedHits,
        memoryIds: [...memoryResult.shortTerm, ...memoryResult.fixed].map((memory) => memory.id),
        hits,
        ...entityMentionMetadata,
      }
    } catch (err) {
      retrieveError = err instanceof Error ? err : new Error(String(err))
    }
  }

  const analyzerErrors = [timeError?.message, semanticError?.message].filter(Boolean) as string[]
  if (
    episodicHits.length > 0
    && !timeError
    && !semanticError
    && queryError?.message === 'Memory query analyzers returned neither retrieval_query nor time_range'
  ) {
    queryError = undefined
  }
  if (!query.retrievalQuery && !query.timeRange && episodicHits.length === 0) {
    if (analyzerErrors.length > 0) {
      queryError = new Error(analyzerErrors.join('; '))
    } else if (!queryError) {
      queryError = new Error('Memory query analyzers returned neither retrieval_query nor time_range')
    }
  }
  const error =
    queryError && retrieveError
      ? new Error(`${queryError.message}; memory retrieve failed: ${retrieveError.message}`)
      : queryError ?? retrieveError
  const metadata: Record<string, unknown> = {
    phase: 'retrieve',
    timeAnalyzer: {
      timeRange: query.timeRange
        ? {
            start: query.timeRange.start.toISOString(),
            end: query.timeRange.end.toISOString(),
          }
        : null,
      error: timeError?.message ?? null,
    },
    semanticAnalyzer: {
      mode: 'llm',
      retrievalQuery: query.retrievalQuery,
      inputPreview: semanticAnalyzer.inputText,
      error: semanticError?.message ?? null,
    },
    mergedQuery: {
      retrievalQuery: query.retrievalQuery,
      timeRange: query.timeRange
        ? {
            start: query.timeRange.start.toISOString(),
            end: query.timeRange.end.toISOString(),
          }
        : null,
    },
    retrievalQuery: query.retrievalQuery,
    timeRange: query.timeRange
      ? {
          start: query.timeRange.start.toISOString(),
          end: query.timeRange.end.toISOString(),
        }
      : null,
  }
  Object.assign(metadata, entityMentionMetadata)

  if (query.retrievalQuery || query.timeRange) {
    const shortTermHits = memoryResult.shortTerm.map((memory) => serializeMemoryHit(memory))
    const fixedHits = memoryResult.fixed.map((memory) => serializeMemoryHit(memory))
    const hits = [...shortTermHits, ...fixedHits]
    metadata.hitCount = hits.length
    metadata.shortTermHitCount = memoryResult.shortTerm.length
    metadata.fixedHitCount = memoryResult.fixed.length
    metadata.shortTermMemoryIds = memoryResult.shortTerm.map((memory) => memory.id)
    metadata.fixedMemoryIds = memoryResult.fixed.map((memory) => memory.id)
    metadata.shortTermHits = shortTermHits
    metadata.fixedHits = fixedHits
    metadata.memoryIds = [...memoryResult.shortTerm, ...memoryResult.fixed].map((memory) => memory.id)
    metadata.hits = hits
  }

  if (callId !== undefined && observer) {
    observer.onLLMCallEnd(callId, {
      response: [
        ...(semanticResponse
          ? [{ type: 'text' as const, text: `[semantic analyzer]\n${extractContentText(semanticResponse.content)}` }]
          : []),
      ],
      stopReason: semanticResponse?.stopReason ?? 'end_turn',
      usage: {
        inputTokens: semanticResponse?.usage.inputTokens ?? 0,
        outputTokens: semanticResponse?.usage.outputTokens ?? 0,
      },
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
