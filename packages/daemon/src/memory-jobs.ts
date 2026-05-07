import { createProvider, type LLMProvider, type Message } from '@mas/core'
import {
  agentMemorySleepStateRepo,
  agentRepo,
  appSettingsRepo,
  daemonEventRepo,
  episodicMemoryGraphRepo,
  memoryRepo,
  messageRepo,
  sessionContextStateRepo,
  sessionRepo,
} from '@mas/db'
import {
  buildContextToShortTermPrompt,
  buildContextToShortTermSourceText,
  buildShortTermToLongTermPrompt,
  buildShortTermToLongTermSourceText,
  type ConversationMessage,
  type MemoryEmbedder,
  type MemoryEmbeddingProvider,
  createMemoryEmbedder,
  DEFAULT_MEMORY_EMBEDDING_MODEL,
  buildEntityResolutionPrompt,
  buildEpisodicExtractionPrompt,
  isSqliteMemoryConfig,
  MEMORY_BATCH_WRITE_RESPONSE_FORMAT,
  parseMemoryBatchWriteResponse,
  parseEntityResolutionResponse,
  parseEpisodicExtractionResponse,
  parseShortTermToLongTermResponse,
  resolveMemoryActorLabels,
  resolveMemoryPipelineSettings,
  resolveMemorySqliteConfig,
  SHORT_TERM_TO_LONG_TERM_RESPONSE_FORMAT,
} from '@mas/systems'
import type { MemoryRecord, ShortTermToLongTermMemoryWriteResult } from '@mas/systems'

type DbMessage = ReturnType<typeof messageRepo.getSessionMessages>[number]

const EPISODIC_STAGE_B_LOCAL_ENTITY_BATCH_SIZE = 5
const EPISODIC_STAGE_B_CANDIDATE_LIMIT = 5
const EPISODIC_STAGE_A_STM_BATCH_SIZE = 3
const DEFAULT_ENTITY_CANDIDATE_EMBEDDING_MODEL = 'BAAI/bge-m3'

type StageBLocalEntity = {
  localEntityId: string
  surface: string
  type: 'person' | 'place' | 'object' | 'event'
  contextHint: string
}

type MemoryEntityWithStats = ReturnType<typeof episodicMemoryGraphRepo.listMemoryEntitiesByAgent>[number]

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

function extractTextFromContent(content: Array<{ type: string; text?: string }>) {
  return content
    .map((block) => block.type === 'text' ? block.text ?? '' : '')
    .join('\n')
}

function resolveEntityCandidateEmbeddingModel() {
  return process.env.MAS_ENTITY_EMBEDDING_MODEL?.trim() || DEFAULT_ENTITY_CANDIDATE_EMBEDDING_MODEL
}

function compactLines(lines: Array<string | null | undefined>) {
  return lines
    .map((line) => line?.trim())
    .filter((line): line is string => Boolean(line))
    .join('\n')
}

function buildLocalEntityEmbeddingText(entity: StageBLocalEntity) {
  return compactLines([
    `surface: ${entity.surface}`,
    `type: ${entity.type}`,
    entity.contextHint ? `context_hint: ${entity.contextHint}` : null,
  ])
}

function buildMemoryEntityEmbeddingText(entity: MemoryEntityWithStats) {
  return compactLines([
    `canonical_name: ${entity.canonicalName}`,
    `type: ${entity.type}`,
    entity.aliases.length > 0 ? `aliases: ${entity.aliases.join(', ')}` : null,
    entity.description ? `description: ${entity.description}` : null,
    `episodic_memory_count: ${entity.episodicMemoryCount}`,
  ])
}

function cosineSimilarity(left: number[], right: number[]) {
  if (left.length === 0 || right.length === 0 || left.length !== right.length) {
    return 0
  }

  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index]!
    const rightValue = right[index]!
    dot += leftValue * rightValue
    leftNorm += leftValue * leftValue
    rightNorm += rightValue * rightValue
  }

  return leftNorm > 0 && rightNorm > 0
    ? dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm))
    : 0
}

async function rankStageBEntityCandidatesByEmbedding(input: {
  agentId: string
  localEntities: StageBLocalEntity[]
  embedder: MemoryEmbedder
  model: string
  limit: number
  now: Date
}) {
  const existingEntities = episodicMemoryGraphRepo.listMemoryEntitiesByAgent(input.agentId)
  if (existingEntities.length === 0 || input.localEntities.length === 0) {
    return new Map<string, MemoryEntityWithStats[]>()
  }

  const entityCards = existingEntities.map((entity) => ({
    entity,
    embeddingText: buildMemoryEntityEmbeddingText(entity),
  }))
  const staleEntityCards = entityCards.filter(({ entity, embeddingText }) =>
    entity.embeddingModel !== input.model
    || entity.embeddingText !== embeddingText
    || entity.embedding.length === 0,
  )
  const freshEmbeddings = staleEntityCards.length > 0
    ? await input.embedder.embed(
        staleEntityCards.map((card) => card.embeddingText),
        { model: input.model, inputType: 'search_document' },
      )
    : []
  const refreshedEmbeddingsByEntityId = new Map<string, number[]>()

  for (const [index, card] of staleEntityCards.entries()) {
    const embedding = freshEmbeddings[index] ?? []
    refreshedEmbeddingsByEntityId.set(card.entity.id, embedding)
    episodicMemoryGraphRepo.updateEntityEmbedding({
      entityId: card.entity.id,
      embeddingText: card.embeddingText,
      embedding,
      embeddingModel: input.model,
      now: input.now,
    })
  }

  const localEmbeddings = await input.embedder.embed(
    input.localEntities.map(buildLocalEntityEmbeddingText),
    { model: input.model, inputType: 'search_query' },
  )
  const candidatesByLocalId = new Map<string, MemoryEntityWithStats[]>()

  for (const [localIndex, localEntity] of input.localEntities.entries()) {
    const localEmbedding = localEmbeddings[localIndex] ?? []
    const candidates = existingEntities
      .map((entity) => ({
        entity,
        score: cosineSimilarity(
          localEmbedding,
          refreshedEmbeddingsByEntityId.get(entity.id) ?? entity.embedding,
        ),
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, input.limit)
      .map((candidate) => candidate.entity)

    candidatesByLocalId.set(localEntity.localEntityId, candidates)
  }

  return candidatesByLocalId
}

async function refreshSingleEntityEmbedding(input: {
  agentId: string
  entityId: string
  embedder: MemoryEmbedder
  model: string
  now: Date
}) {
  const entity = episodicMemoryGraphRepo
    .listMemoryEntitiesByAgent(input.agentId)
    .find((item) => item.id === input.entityId)
  if (!entity) {
    return
  }

  const embeddingText = buildMemoryEntityEmbeddingText(entity)
  const [embedding = []] = await input.embedder.embed(
    [embeddingText],
    { model: input.model, inputType: 'search_document' },
  )
  episodicMemoryGraphRepo.updateEntityEmbedding({
    entityId: entity.id,
    embeddingText,
    embedding,
    embeddingModel: input.model,
    now: input.now,
  })
}

function toConversationMessage(message: DbMessage): ConversationMessage {
  return {
    role: message.role as ConversationMessage['role'],
    content: JSON.parse(message.content) as Message['content'],
    createdAt: message.createdAt,
  }
}

function selectActiveDbMessages(
  dbMessages: DbMessage[],
  activeStartMessageId: string | null | undefined,
) {
  if (!activeStartMessageId) {
    return []
  }

  const startIndex = dbMessages.findIndex((message) => message.id === activeStartMessageId)
  return startIndex >= 0 ? dbMessages.slice(startIndex) : dbMessages
}

function groupIntoTurns(messages: DbMessage[]) {
  const turns: DbMessage[][] = []
  let current: DbMessage[] = []

  for (const message of messages) {
    if (message.role === 'user' && current.length > 0) {
      turns.push(current)
      current = [message]
      continue
    }
    current.push(message)
  }

  if (current.length > 0) {
    turns.push(current)
  }

  return turns
}

function selectOverflowCandidate(messages: DbMessage[], windowSize: number, batchSize: number) {
  if (messages.length <= windowSize) {
    return []
  }

  const turns = groupIntoTurns(messages)
  const selected: DbMessage[] = []
  let removedCount = 0

  for (const turn of turns) {
    if (messages.length - removedCount <= windowSize) {
      break
    }
    if (selected.length > 0 && removedCount >= batchSize) {
      break
    }
    selected.push(...turn)
    removedCount += turn.length
  }

  return selected
}

function atOrAfterLocalTime(now: Date, hhmm: string) {
  const [hours, minutes] = hhmm.split(':').map((value) => Number(value))
  const scheduled = new Date(now)
  scheduled.setHours(hours ?? 0, minutes ?? 0, 0, 0)
  return { scheduled, due: now.getTime() >= scheduled.getTime() }
}

function isSleepDue(input: {
  lastSleepAt: Date | null
  now: Date
  sleepTimeLocal: string
  sleepIntervalDays: number
}) {
  const { scheduled, due } = atOrAfterLocalTime(input.now, input.sleepTimeLocal)
  if (!due) {
    return false
  }
  if (!input.lastSleepAt) {
    return true
  }

  const elapsed = input.now.getTime() - input.lastSleepAt.getTime()
  const required = input.sleepIntervalDays * 24 * 60 * 60 * 1000
  return elapsed >= required && input.lastSleepAt.getTime() < scheduled.getTime()
}

async function persistMemories(input: {
  agentId: string
  sessionId: string
  layer: 'short_term' | 'long_term'
  sourceText: string
  memoryWrites: ReturnType<typeof parseMemoryBatchWriteResponse>
  embeddingProvider: MemoryEmbeddingProvider
  embeddingModel: string
  embedder?: MemoryEmbedder
  observedStartAt?: Date | null
  observedEndAt?: Date | null
}) {
  if (input.memoryWrites.length === 0) {
    return []
  }

  const embedder = input.embedder ?? createMemoryEmbedder(input.embeddingProvider)
  const embeddings = await embedder.embed(
    input.memoryWrites.map((memory) => memory.retrievalText),
    {
      model: input.embeddingModel || DEFAULT_MEMORY_EMBEDDING_MODEL,
      inputType: 'search_document',
    },
  )

  return input.memoryWrites.map((memory, index) => memoryRepo.addMemory({
    agentId: input.agentId,
    sessionId: input.sessionId,
    layer: input.layer,
    sourceText: input.sourceText,
    detail: memory.detail,
    retrievalText: memory.retrievalText,
    retrievalEmbedding: embeddings[index] ?? [],
    retrievalModel: input.embeddingModel || DEFAULT_MEMORY_EMBEDDING_MODEL,
    tags: [],
    importance: memory.importance,
    observedStartAt: input.observedStartAt ?? null,
    observedEndAt: input.observedEndAt ?? null,
  }))
}

function getObservedRangeFromMemories(memories: MemoryRecord[]) {
  const starts = memories
    .map((memory) => memory.observedStartAt)
    .filter((date): date is Date => date instanceof Date && Number.isFinite(date.getTime()))
  const ends = memories
    .map((memory) => memory.observedEndAt)
    .filter((date): date is Date => date instanceof Date && Number.isFinite(date.getTime()))

  return {
    observedStartAt: starts.length > 0
      ? new Date(Math.min(...starts.map((date) => date.getTime())))
      : null,
    observedEndAt: ends.length > 0
      ? new Date(Math.max(...ends.map((date) => date.getTime())))
      : null,
  }
}

function toLongTermObservedHourRange(range: {
  observedStartAt: Date | null
  observedEndAt: Date | null
}) {
  if (!range.observedStartAt || !range.observedEndAt) {
    return range
  }

  const observedStartAt = new Date(range.observedStartAt)
  observedStartAt.setMinutes(0, 0, 0)
  const observedEndAt = new Date(range.observedEndAt)
  observedEndAt.setMinutes(59, 59, 999)

  return { observedStartAt, observedEndAt }
}

async function persistLongTermMemoriesFromShortTerm(input: {
  agentId: string
  fallbackSessionId: string
  memoryWrites: ShortTermToLongTermMemoryWriteResult[]
  shortTermMemoriesById: Map<string, MemoryRecord>
  embeddingProvider: MemoryEmbeddingProvider
  embeddingModel: string
  embedder?: MemoryEmbedder
}) {
  if (input.memoryWrites.length === 0) {
    return []
  }

  const embedder = input.embedder ?? createMemoryEmbedder(input.embeddingProvider)
  const embeddings = await embedder.embed(
    input.memoryWrites.map((memory) => memory.retrievalText),
    {
      model: input.embeddingModel || DEFAULT_MEMORY_EMBEDDING_MODEL,
      inputType: 'search_document',
    },
  )

  return input.memoryWrites.map((memory, index) => {
    const sourceMemories = memory.sourceStmIds
      .map((id) => input.shortTermMemoriesById.get(id))
      .filter((source): source is MemoryRecord => Boolean(source))
    const { observedStartAt, observedEndAt } = toLongTermObservedHourRange(
      getObservedRangeFromMemories(sourceMemories),
    )

    return {
      memory: memoryRepo.addMemory({
        agentId: input.agentId,
        sessionId: sourceMemories[0]?.sessionId ?? input.fallbackSessionId,
        layer: 'long_term',
        sourceText: buildShortTermToLongTermSourceText(sourceMemories),
        detail: memory.detail,
        retrievalText: memory.retrievalText,
        retrievalEmbedding: embeddings[index] ?? [],
        retrievalModel: input.embeddingModel || DEFAULT_MEMORY_EMBEDDING_MODEL,
        tags: [],
        importance: memory.importance,
        observedStartAt,
        observedEndAt,
      }),
      sourceStmIds: memory.sourceStmIds,
    }
  })
}

export async function runContextFlushForSession(input: {
  sessionId: string
  mode?: 'idle' | 'overflow' | 'manual'
  now?: Date
  signal?: AbortSignal
  provider?: Pick<LLMProvider, 'sendMessage'>
  embedder?: MemoryEmbedder
}) {
  const session = sessionRepo.getSession(input.sessionId)
  if (!session) {
    return { ok: false as const, reason: 'session_not_found' as const }
  }

  const agent = agentRepo.getAgent(session.agentId)
  if (!agent || !isSqliteMemoryConfig(agent.modules?.memory)) {
    return { ok: false as const, reason: 'memory_not_sqlite' as const }
  }

  const now = input.now ?? new Date()
  const mode = input.mode ?? 'manual'

  daemonEventRepo.appendEvent({
    kind: 'flush_started',
    scope: 'memory_flush',
    message: 'context flush 开始',
    payload: {
      sessionId: input.sessionId,
      agentId: agent.id,
      mode,
    },
  })

  const settings = resolveMemoryPipelineSettings(agent.modules?.memory)
  const locale = appSettingsRepo.getAppLocale()
  const memoryConfig = resolveMemorySqliteConfig(agent.modules?.memory, locale)
  const dbMessages = messageRepo.getSessionMessages(input.sessionId)
  if (dbMessages.length === 0) {
    daemonEventRepo.appendEvent({
      kind: 'flush_failed',
      scope: 'memory_flush',
      message: 'context flush 失败：没有消息',
      payload: {
        sessionId: input.sessionId,
        agentId: agent.id,
        mode,
        reason: 'no_messages',
      },
    })
    return { ok: false as const, reason: 'no_messages' as const }
  }

  const existingState = sessionContextStateRepo.getSessionContextState(input.sessionId)
  const activeStartMessageId = existingState
    ? existingState.activeStartMessageId
    : (dbMessages[0]?.id ?? null)

  if (!existingState) {
    sessionContextStateRepo.upsertSessionContextState({
      sessionId: input.sessionId,
      activeStartMessageId,
      lastUserMessageAt: dbMessages
        .filter((message) => message.role === 'user')
        .at(-1)?.createdAt ?? null,
    })
  }

  const activeMessages = selectActiveDbMessages(dbMessages, activeStartMessageId)
  if (activeMessages.length === 0) {
    daemonEventRepo.appendEvent({
      kind: 'flush_failed',
      scope: 'memory_flush',
      message: 'context flush 失败：没有活跃 context',
      payload: {
        sessionId: input.sessionId,
        agentId: agent.id,
        mode,
        reason: 'no_active_context',
      },
    })
    return { ok: false as const, reason: 'no_active_context' as const }
  }

  let candidateMessages: DbMessage[] = []
  if (mode === 'overflow') {
    candidateMessages = selectOverflowCandidate(
      activeMessages,
      settings.contextWindowMessages,
      settings.contextOverflowBatchSize,
    )
  } else if (mode === 'idle') {
    const lastUserAt = existingState?.lastUserMessageAt
      ?? dbMessages.filter((message) => message.role === 'user').at(-1)?.createdAt
      ?? null
    const idleMs = settings.contextIdleFlushMinutes * 60 * 1000
    if (!lastUserAt || now.getTime() - lastUserAt.getTime() < idleMs) {
      daemonEventRepo.appendEvent({
        kind: 'flush_failed',
        scope: 'memory_flush',
        message: 'context flush 跳过：尚未达到空闲阈值',
        payload: {
          sessionId: input.sessionId,
          agentId: agent.id,
          mode,
          reason: 'not_idle_enough',
        },
      })
      return { ok: false as const, reason: 'not_idle_enough' as const }
    }
    candidateMessages = selectOverflowCandidate(
      activeMessages,
      settings.contextWindowMessages,
      settings.contextOverflowBatchSize,
    )
  } else {
    candidateMessages = activeMessages.length > settings.contextWindowMessages
      ? selectOverflowCandidate(activeMessages, settings.contextWindowMessages, settings.contextOverflowBatchSize)
      : activeMessages
  }

  if (candidateMessages.length === 0) {
    daemonEventRepo.appendEvent({
      kind: 'flush_failed',
      scope: 'memory_flush',
      message: 'context flush 跳过：没有可搬运的旧 context',
      payload: {
        sessionId: input.sessionId,
        agentId: agent.id,
        mode,
        reason: 'nothing_to_flush',
      },
    })
    return { ok: false as const, reason: 'nothing_to_flush' as const }
  }

  const provider = input.provider ?? createProvider(agent.provider)
  const actorLabels = resolveMemoryActorLabels({
    agentId: agent.id,
    sessionId: input.sessionId,
    agentModules: agent.modules,
  })
  const sourceText = buildContextToShortTermSourceText(
    candidateMessages.map(toConversationMessage),
    actorLabels,
  )
  const candidateTimes = candidateMessages
    .map((message) => message.createdAt)
    .filter((date): date is Date => date instanceof Date && Number.isFinite(date.getTime()))
  const observedStartAt = candidateTimes.length > 0
    ? new Date(Math.min(...candidateTimes.map((date) => date.getTime())))
    : null
  const observedEndAt = candidateTimes.length > 0
    ? new Date(Math.max(...candidateTimes.map((date) => date.getTime())))
    : null
  const response = await provider.sendMessage({
    model: memoryConfig.summarizeModel ?? agent.model,
    systemPrompt: buildContextToShortTermPrompt(
      memoryConfig.contextToShortTermPrompt,
      settings.maxShortTermMemoriesPerFlush,
      locale,
    ),
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: sourceText }],
      },
    ],
    reasoning: { effort: 'none' },
    responseFormat: MEMORY_BATCH_WRITE_RESPONSE_FORMAT,
    signal: input.signal,
  })

  const memoryWrites = parseMemoryBatchWriteResponse(
    response.content
      .map((block) => block.type === 'text' ? block.text : '')
      .join('\n'),
    settings.maxShortTermMemoriesPerFlush,
  )

  const created = await persistMemories({
    agentId: agent.id,
    sessionId: input.sessionId,
    layer: 'short_term',
    sourceText,
    memoryWrites,
    embeddingProvider: memoryConfig.embeddingProvider,
    embeddingModel: memoryConfig.embeddingModel,
    embedder: input.embedder,
    observedStartAt,
    observedEndAt,
  })

  const nextActiveStartMessageId = candidateMessages.length === activeMessages.length
    ? null
    : activeMessages[candidateMessages.length]?.id ?? null

  sessionContextStateRepo.recordContextFlush({
    sessionId: input.sessionId,
    nextActiveStartMessageId,
    pendingFlushUntilMessageId: null,
    at: now,
  })

  daemonEventRepo.appendEvent({
    kind: 'flush_success',
    scope: 'memory_flush',
    message: 'context flush 完成',
    payload: {
      sessionId: input.sessionId,
      agentId: agent.id,
      mode,
      createdCount: created.length,
      flushedMessageCount: candidateMessages.length,
      nextActiveStartMessageId,
    },
  })

  return {
    ok: true as const,
    mode,
    createdCount: created.length,
    memoryIds: created.map((memory) => memory.id),
    nextActiveStartMessageId,
    flushedMessageCount: candidateMessages.length,
  }
}

export async function runSleepForAgent(input: {
  agentId: string
  mode?: 'scheduled' | 'manual'
  now?: Date
  signal?: AbortSignal
  provider?: Pick<LLMProvider, 'sendMessage'>
  embedder?: MemoryEmbedder
}) {
  const agent = agentRepo.getAgent(input.agentId)
  if (!agent || !isSqliteMemoryConfig(agent.modules?.memory)) {
    return { ok: false as const, reason: 'memory_not_sqlite' as const }
  }

  const now = input.now ?? new Date()
  const mode = input.mode ?? 'scheduled'

  daemonEventRepo.appendEvent({
    kind: 'sleep_started',
    scope: 'memory_sleep',
    message: 'sleep 开始',
    payload: {
      agentId: input.agentId,
      mode,
    },
  })

  const settings = resolveMemoryPipelineSettings(agent.modules?.memory)
  if (!settings.sleepEnabled && input.mode !== 'manual') {
    daemonEventRepo.appendEvent({
      kind: 'sleep_failed',
      scope: 'memory_sleep',
      message: 'sleep 跳过：功能未启用',
      payload: {
        agentId: input.agentId,
        mode,
        reason: 'sleep_disabled',
      },
    })
    return { ok: false as const, reason: 'sleep_disabled' as const }
  }

  const sleepState = agentMemorySleepStateRepo.getAgentMemorySleepState(agent.id)
  if (input.mode !== 'manual' && !isSleepDue({
    lastSleepAt: sleepState?.lastSleepAt ?? null,
    now,
    sleepTimeLocal: settings.sleepTimeLocal,
    sleepIntervalDays: settings.sleepIntervalDays,
  })) {
    daemonEventRepo.appendEvent({
      kind: 'sleep_failed',
      scope: 'memory_sleep',
      message: 'sleep 跳过：尚未到睡眠时间',
      payload: {
        agentId: input.agentId,
        mode,
        reason: 'not_sleep_time',
      },
    })
    return { ok: false as const, reason: 'not_sleep_time' as const }
  }

  const locale = appSettingsRepo.getAppLocale()
  const memoryConfig = resolveMemorySqliteConfig(agent.modules?.memory, locale)
  const shortTermMemories = memoryRepo
    .listMemoriesByAgentOldestFirst(agent.id)
    .filter((memory) => memory.layer === 'short_term')

  if (shortTermMemories.length === 0) {
    agentMemorySleepStateRepo.upsertAgentMemorySleepState({
      agentId: agent.id,
      lastSleepAt: now,
    })
    daemonEventRepo.appendEvent({
      kind: 'sleep_success',
      scope: 'memory_sleep',
      message: 'sleep 完成：没有可沉淀的短期记忆',
      payload: {
        agentId: input.agentId,
        mode,
        createdCount: 0,
        deletedShortTermCount: 0,
        retainedShortTermCount: 0,
      },
    })
    return { ok: true as const, createdCount: 0, deletedShortTermCount: 0, retainedShortTermCount: 0 }
  }

  const provider = input.provider ?? createProvider(agent.provider)
  const sourceText = buildShortTermToLongTermSourceText(shortTermMemories)
  const response = await provider.sendMessage({
    model: memoryConfig.summarizeModel ?? agent.model,
    systemPrompt: buildShortTermToLongTermPrompt(
      memoryConfig.shortTermToLongTermPrompt,
      settings.maxShortTermMemoriesPerFlush,
      locale,
    ),
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: sourceText }],
      },
    ],
    reasoning: { effort: 'none' },
    responseFormat: SHORT_TERM_TO_LONG_TERM_RESPONSE_FORMAT,
    signal: input.signal,
  })

  const shortTermMemoryIds = new Set(shortTermMemories.map((memory) => memory.id))
  const memoryWrites = parseShortTermToLongTermResponse(
    response.content
      .map((block) => block.type === 'text' ? block.text : '')
      .join('\n'),
    settings.maxShortTermMemoriesPerFlush,
    shortTermMemoryIds,
  )

  const shortTermMemoriesById = new Map(shortTermMemories.map((memory) => [memory.id, memory]))
  const created = await persistLongTermMemoriesFromShortTerm({
    agentId: agent.id,
    fallbackSessionId: shortTermMemories[0]!.sessionId,
    memoryWrites,
    shortTermMemoriesById,
    embeddingProvider: memoryConfig.embeddingProvider,
    embeddingModel: memoryConfig.embeddingModel,
    embedder: input.embedder,
  })

  const usedShortTermIds = new Set(created.flatMap((item) => item.sourceStmIds))
  for (const memoryId of usedShortTermIds) {
    memoryRepo.deleteSqliteMemoryByAgent(agent.id, memoryId)
  }

  agentMemorySleepStateRepo.upsertAgentMemorySleepState({
    agentId: agent.id,
    lastSleepAt: now,
  })

  daemonEventRepo.appendEvent({
    kind: 'sleep_success',
    scope: 'memory_sleep',
    message: 'sleep 完成',
    payload: {
      agentId: input.agentId,
      mode,
      createdCount: created.length,
      deletedShortTermCount: usedShortTermIds.size,
      retainedShortTermCount: shortTermMemories.length - usedShortTermIds.size,
    },
  })

  return {
    ok: true as const,
    createdCount: created.length,
    memoryIds: created.map((item) => item.memory.id),
    deletedShortTermCount: usedShortTermIds.size,
    retainedShortTermCount: shortTermMemories.length - usedShortTermIds.size,
  }
}

export async function runEpisodicConsolidationForAgent(input: {
  agentId: string
  now?: Date
  signal?: AbortSignal
  provider?: Pick<LLMProvider, 'sendMessage'>
  embedder?: MemoryEmbedder
}) {
  const agent = agentRepo.getAgent(input.agentId)
  if (!agent || !isSqliteMemoryConfig(agent.modules?.memory)) {
    return { ok: false as const, reason: 'memory_not_sqlite' as const }
  }

  const now = input.now ?? new Date()
  const locale = appSettingsRepo.getAppLocale()
  const memoryConfig = resolveMemorySqliteConfig(agent.modules?.memory, locale)
  const provider = input.provider ?? createProvider(agent.provider)
  const embedder = input.embedder ?? createMemoryEmbedder(memoryConfig.embeddingProvider)
  const retrievalModel = memoryConfig.embeddingModel || DEFAULT_MEMORY_EMBEDDING_MODEL
  let createdEntityCount = 0
  let createdEpisodicCount = 0
  let deletedShortTermCount = 0

  while (true) {
    const shortTermMemories = memoryRepo
      .listMemoriesByAgentOldestFirst(agent.id)
      .filter((memory) => memory.layer === 'short_term')
      .slice(0, EPISODIC_STAGE_A_STM_BATCH_SIZE)

    if (shortTermMemories.length === 0) {
      return {
        ok: true as const,
        createdEntityCount,
        createdEpisodicCount,
        deletedShortTermCount,
      }
    }

    const sourceText = buildShortTermToLongTermSourceText(shortTermMemories)
    const extractionResponse = await provider.sendMessage({
      model: memoryConfig.summarizeModel ?? agent.model,
      systemPrompt: buildEpisodicExtractionPrompt(memoryConfig.episodicExtractionPrompt, locale),
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: sourceText }],
        },
      ],
      reasoning: { effort: 'none' },
      signal: input.signal,
    })
    const extraction = parseEpisodicExtractionResponse(
      extractTextFromContent(extractionResponse.content),
    )
    const usableEpisodicDrafts = extraction.episodicMemories
      .filter((draft) => draft.entityLinks.length > 0)

    if (usableEpisodicDrafts.length > 0) {
      const referencedLocalEntityIds = new Set(
        usableEpisodicDrafts.flatMap((draft) =>
          draft.entityLinks.map((link) => link.localEntityId),
        ),
      )
      const resolutionLocalEntities = extraction.entities
        .filter((entity) => referencedLocalEntityIds.has(entity.localEntityId))
      const candidatesByLocalId = await rankStageBEntityCandidatesByEmbedding({
        agentId: agent.id,
        localEntities: resolutionLocalEntities,
        embedder,
        model: resolveEntityCandidateEmbeddingModel(),
        limit: EPISODIC_STAGE_B_CANDIDATE_LIMIT,
        now,
      })
      const candidatePayloads = resolutionLocalEntities
        .map((entity) => ({
          local_entity_id: entity.localEntityId,
          surface: entity.surface,
          type: entity.type,
          context_hint: entity.contextHint,
          candidates: (candidatesByLocalId.get(entity.localEntityId) ?? []).map((candidate) => ({
            entity_id: candidate.id,
            canonical_name: candidate.canonicalName,
            type: candidate.type,
            description: candidate.description,
          })),
        }))
      const extractionEntitiesById = new Map(
        extraction.entities.map((entity) => [entity.localEntityId, entity]),
      )
      const entityIdsByLocalId = new Map<string, string>()
      const entityCandidateEmbeddingModel = resolveEntityCandidateEmbeddingModel()

      for (const candidateBatch of chunkArray(candidatePayloads, EPISODIC_STAGE_B_LOCAL_ENTITY_BATCH_SIZE)) {
        const batchLocalEntityIds = new Set(candidateBatch.map((candidate) => candidate.local_entity_id))
        const resolutionResponse = await provider.sendMessage({
          model: memoryConfig.summarizeModel ?? agent.model,
          systemPrompt: buildEntityResolutionPrompt(memoryConfig.entityResolutionPrompt, locale),
          messages: [
            {
              role: 'user',
              content: [{ type: 'text', text: JSON.stringify(candidateBatch, null, 2) }],
            },
          ],
          reasoning: { effort: 'none' },
          signal: input.signal,
        })
        const resolutions = parseEntityResolutionResponse(
          extractTextFromContent(resolutionResponse.content),
        )

        for (const resolution of resolutions) {
          if (!batchLocalEntityIds.has(resolution.localEntityId)) {
            continue
          }

          if (resolution.action === 'merge') {
            entityIdsByLocalId.set(resolution.localEntityId, resolution.entityId)
            if (resolution.aliasToAdd) {
              const aliasAdded = episodicMemoryGraphRepo.addEntityAlias({
                entityId: resolution.entityId,
                alias: resolution.aliasToAdd,
                confidence: resolution.confidence,
                now,
              })
              if (aliasAdded) {
                await refreshSingleEntityEmbedding({
                  agentId: agent.id,
                  entityId: resolution.entityId,
                  embedder,
                  model: entityCandidateEmbeddingModel,
                  now,
                })
              }
            }
            continue
          }

          const sourceEntity = extractionEntitiesById.get(resolution.localEntityId)
          const canonicalName = resolution.canonicalName || sourceEntity?.surface || resolution.localEntityId
          const exactExisting = episodicMemoryGraphRepo.findEntityCandidates({
            agentId: agent.id,
            type: resolution.type,
            surface: canonicalName,
            limit: 1,
          }).find((candidate) => candidate.matchKind === 'exact')
          if (exactExisting) {
            entityIdsByLocalId.set(resolution.localEntityId, exactExisting.entity.id)
            continue
          }

          const entity = episodicMemoryGraphRepo.createEntity({
            agentId: agent.id,
            type: resolution.type,
            canonicalName,
            description: sourceEntity?.contextHint ?? null,
            confidence: resolution.confidence,
            aliases: [],
            now,
          })
          await refreshSingleEntityEmbedding({
            agentId: agent.id,
            entityId: entity.id,
            embedder,
            model: entityCandidateEmbeddingModel,
            now,
          })
          createdEntityCount += 1
          entityIdsByLocalId.set(resolution.localEntityId, entity.id)
        }
      }

      const observedRange = getObservedRangeFromMemories(shortTermMemories)
      const preparedDrafts = usableEpisodicDrafts.flatMap((draft) => {
        const entityLinks = draft.entityLinks
          .map((link) => ({
            entityId: entityIdsByLocalId.get(link.localEntityId),
            weight: link.weight,
          }))
          .filter((link): link is { entityId: string; weight: number } => Boolean(link.entityId))
          .slice(0, 5)

        if (entityLinks.length === 0) {
          return []
        }

        return [{ draft, entityLinks }]
      })

      const retrievalEmbeddings = preparedDrafts.length > 0
        ? await embedder.embed(
          preparedDrafts.map((draft) => draft.draft.summary),
          {
            model: retrievalModel,
            inputType: 'search_document',
          },
        )
        : []

      for (const [index, prepared] of preparedDrafts.entries()) {
        episodicMemoryGraphRepo.createEpisodicMemory({
          agentId: agent.id,
          sessionId: shortTermMemories[0]!.sessionId,
          summary: prepared.draft.summary,
          sourceText,
          detail: prepared.draft.detail,
          retrievalEmbedding: retrievalEmbeddings[index] ?? [],
          retrievalModel,
          importance: prepared.draft.importance,
          observedStartAt: observedRange.observedStartAt,
          observedEndAt: observedRange.observedEndAt,
          entityLinks: prepared.entityLinks,
          now,
        })
        createdEpisodicCount += 1

        for (let leftIndex = 0; leftIndex < prepared.entityLinks.length; leftIndex += 1) {
          for (let rightIndex = leftIndex + 1; rightIndex < prepared.entityLinks.length; rightIndex += 1) {
            const left = prepared.entityLinks[leftIndex]!
            const right = prepared.entityLinks[rightIndex]!
            episodicMemoryGraphRepo.upsertEntityEdge({
              agentId: agent.id,
              sourceEntityId: left.entityId,
              targetEntityId: right.entityId,
              delta: 0.1 * Math.min(left.weight, right.weight) * prepared.draft.importance,
              now,
            })
          }
        }
      }
    }

    for (const memory of shortTermMemories) {
      memoryRepo.deleteSqliteMemoryByAgent(agent.id, memory.id)
    }
    deletedShortTermCount += shortTermMemories.length
  }
}

export async function processMemoryJobs(signal?: AbortSignal) {
  const sessions = sessionRepo.listAllSessions().filter((session) => session.status === 'active')
  for (const session of sessions) {
    await runContextFlushForSession({
      sessionId: session.id,
      mode: 'overflow',
      signal,
    })
    await runContextFlushForSession({
      sessionId: session.id,
      mode: 'idle',
      signal,
    })
  }

  const agents = agentRepo.listAgents()
  for (const agent of agents) {
    await runSleepForAgent({
      agentId: agent.id,
      mode: 'scheduled',
      signal,
    })
  }
}
