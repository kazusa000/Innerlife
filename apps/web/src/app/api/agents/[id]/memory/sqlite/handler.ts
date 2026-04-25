import {
  agentMemorySleepStateRepo,
  agentRepo,
  memoryRepo,
  messageRepo,
  sessionContextStateRepo,
  sessionRepo,
} from '@mas/db'
import {
  buildContextToShortTermPrompt,
  buildFixedMemoryFragmentPrompt,
  buildMemoryFragmentPrompt,
  buildSemanticAnalyzerPrompt,
  buildShortTermFragmentPrompt,
  buildShortTermToLongTermPrompt,
  isSqliteMemoryConfig,
  resolveMemoryPipelineSettings,
  resolveMemorySqliteConfig,
} from '@mas/systems'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

type MemoryListOptions = {
  page?: number
  pageSize?: number
  layer?: 'short_term' | 'long_term' | 'fixed'
}

type SessionMessageRecord = ReturnType<typeof messageRepo.getSessionMessages>[number]

function readOptionalText(value: unknown) {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed || null
}

function readOptionalInt(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value)
  }
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed)
    }
  }
  return null
}

function readOptionalProbability(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.min(1, Math.max(0, value))
  }
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return Math.min(1, Math.max(0, parsed))
    }
  }
  return null
}

function readOptionalBoolean(value: unknown) {
  return typeof value === 'boolean' ? value : null
}

function hasOwn(body: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(body, key)
}

function selectActiveDbMessages(
  dbMessages: SessionMessageRecord[],
  activeStartMessageId: string | null | undefined,
) {
  if (!activeStartMessageId) {
    return []
  }

  const startIndex = dbMessages.findIndex((message) => message.id === activeStartMessageId)
  return startIndex >= 0 ? dbMessages.slice(startIndex) : dbMessages
}

export function listSqliteMemories(agentId: string, query?: string, options: MemoryListOptions = {}) {
  const agent = agentRepo.getAgent(agentId)
  if (!agent) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  if (!isSqliteMemoryConfig(agent.modules?.memory)) {
    return Response.json({ error: 'Agent memory scheme must be sqlite' }, { status: 400 })
  }

  const memoryConfig = resolveMemorySqliteConfig(agent.modules?.memory)
  const pipelineSettings = resolveMemoryPipelineSettings(agent.modules?.memory)
  const page = typeof options.page === 'number' ? options.page : 1
  const pageSize = typeof options.pageSize === 'number' ? options.pageSize : 20
  const result = memoryRepo.listSqliteMemoriesPageByAgent({
    agentId,
    query,
    layer: options.layer,
    page,
    pageSize,
  })
  const activeSession = sessionRepo.getLatestActiveSessionByAgent(agentId)
  const contextState = activeSession
    ? sessionContextStateRepo.getSessionContextState(activeSession.id)
    : undefined
  const activeSessionMessages = activeSession
    ? messageRepo.getSessionMessages(activeSession.id)
    : []
  const activeMessages = selectActiveDbMessages(
    activeSessionMessages,
    contextState?.activeStartMessageId
      ?? (activeSessionMessages[0]?.id ?? null),
  )
  const sleepState = agentMemorySleepStateRepo.getAgentMemorySleepState(agentId)

  return Response.json({
    agentId,
    scheme: 'sqlite',
    query: query?.trim() ?? '',
    layer: options.layer ?? null,
    page: result.page,
    pageSize: result.pageSize,
    total: result.total,
    summarizeModel: memoryConfig.summarizeModel,
    embeddingModel: memoryConfig.embeddingModel,
    shortTermRetrieveTopK: memoryConfig.shortTermRetrieveTopK,
    fixedRetrieveTopK: memoryConfig.fixedRetrieveTopK,
    shortTermMinSimilarity: memoryConfig.shortTermMinSimilarity,
    fixedMinSimilarity: memoryConfig.fixedMinSimilarity,
    semanticAnalyzerHistoryMessages: memoryConfig.semanticAnalyzerHistoryMessages,
    longTermSearchDefaultTopK: memoryConfig.longTermSearchDefaultTopK,
    showNoHitMemoryFragments: memoryConfig.showNoHitMemoryFragments,
    contextWindowMessages: pipelineSettings.contextWindowMessages,
    contextOverflowBatchSize: pipelineSettings.contextOverflowBatchSize,
    contextIdleFlushMinutes: pipelineSettings.contextIdleFlushMinutes,
    maxShortTermMemoriesPerFlush: pipelineSettings.maxShortTermMemoriesPerFlush,
    sleepEnabled: pipelineSettings.sleepEnabled,
    sleepTimeLocal: pipelineSettings.sleepTimeLocal,
    sleepIntervalDays: pipelineSettings.sleepIntervalDays,
    semanticAnalyzerPrompt:
      readOptionalText((agent.modules?.memory as Record<string, unknown> | undefined)?.semanticAnalyzerPrompt)
      ?? readOptionalText((agent.modules?.memory as Record<string, unknown> | undefined)?.retrievePrompt),
    contextToShortTermPrompt: readOptionalText((agent.modules?.memory as Record<string, unknown> | undefined)?.contextToShortTermPrompt),
    shortTermToLongTermPrompt: readOptionalText((agent.modules?.memory as Record<string, unknown> | undefined)?.shortTermToLongTermPrompt),
    fragmentPrompt: readOptionalText((agent.modules?.memory as Record<string, unknown> | undefined)?.fragmentPrompt),
    shortTermFragmentPrompt: readOptionalText((agent.modules?.memory as Record<string, unknown> | undefined)?.shortTermFragmentPrompt),
    fixedFragmentPrompt: readOptionalText((agent.modules?.memory as Record<string, unknown> | undefined)?.fixedFragmentPrompt),
    semanticAnalyzerPromptDefault: buildSemanticAnalyzerPrompt(),
    semanticAnalyzerPromptEffective: buildSemanticAnalyzerPrompt(memoryConfig.semanticAnalyzerPrompt ?? memoryConfig.retrievePrompt),
    contextToShortTermPromptDefault: buildContextToShortTermPrompt(null, pipelineSettings.maxShortTermMemoriesPerFlush),
    contextToShortTermPromptEffective: buildContextToShortTermPrompt(
      memoryConfig.contextToShortTermPrompt,
      pipelineSettings.maxShortTermMemoriesPerFlush,
    ),
    shortTermToLongTermPromptDefault: buildShortTermToLongTermPrompt(null, pipelineSettings.maxShortTermMemoriesPerFlush),
    shortTermToLongTermPromptEffective: buildShortTermToLongTermPrompt(
      memoryConfig.shortTermToLongTermPrompt,
      pipelineSettings.maxShortTermMemoriesPerFlush,
    ),
    fragmentPromptDefault: buildMemoryFragmentPrompt(),
    fragmentPromptEffective: buildMemoryFragmentPrompt(memoryConfig.fragmentPrompt),
    shortTermFragmentPromptDefault: buildShortTermFragmentPrompt(),
    shortTermFragmentPromptEffective: buildShortTermFragmentPrompt(memoryConfig.shortTermFragmentPrompt ?? memoryConfig.fragmentPrompt),
    fixedFragmentPromptDefault: buildFixedMemoryFragmentPrompt(),
    fixedFragmentPromptEffective: buildFixedMemoryFragmentPrompt(memoryConfig.fixedFragmentPrompt ?? memoryConfig.fragmentPrompt),
    context: {
      activeSessionId: activeSession?.id ?? null,
      activeStartMessageId: contextState?.activeStartMessageId ?? (activeSessionMessages[0]?.id ?? null),
      pendingFlushUntilMessageId: contextState?.pendingFlushUntilMessageId ?? null,
      activeMessageCount: activeMessages.length,
      totalSessionMessages: activeSessionMessages.length,
      lastUserMessageAt: contextState?.lastUserMessageAt?.toISOString() ?? null,
      lastContextFlushAt: contextState?.lastContextFlushAt?.toISOString() ?? null,
    },
    sleep: {
      lastSleepAt: sleepState?.lastSleepAt?.toISOString() ?? null,
    },
    memories: result.memories.map((memory) => ({
      id: memory.id,
      sessionId: memory.sessionId,
      layer: memory.layer,
      summary: memory.displaySummary,
      retrievalText: memory.retrievalText,
      tags: memory.tags,
      importance: memory.importance,
      observedStartAt: memory.observedStartAt?.toISOString() ?? null,
      observedEndAt: memory.observedEndAt?.toISOString() ?? null,
      createdAt: memory.createdAt.toISOString(),
    })),
  })
}

export function clearSqliteMemories(agentId: string) {
  const agent = agentRepo.getAgent(agentId)
  if (!agent) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  if (!isSqliteMemoryConfig(agent.modules?.memory)) {
    return Response.json({ error: 'Agent memory scheme must be sqlite' }, { status: 400 })
  }

  const deletedCount = memoryRepo.deleteMemoriesByAgent(agentId)
  return Response.json({ ok: true, deletedCount })
}

export function updateSqliteMemorySettings(agentId: string, input: unknown) {
  const agent = agentRepo.getAgent(agentId)
  if (!agent) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  if (!isSqliteMemoryConfig(agent.modules?.memory)) {
    return Response.json({ error: 'Agent memory scheme must be sqlite' }, { status: 400 })
  }

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return Response.json({ error: 'Request body must be an object' }, { status: 400 })
  }

  const body = input as Record<string, unknown>
  const stringOrNullFields = [
    'summarizeModel',
    'embeddingModel',
    'semanticAnalyzerPrompt',
    'contextToShortTermPrompt',
    'shortTermToLongTermPrompt',
    'fragmentPrompt',
    'shortTermFragmentPrompt',
    'fixedFragmentPrompt',
    'sleepTimeLocal',
  ] as const

  for (const field of stringOrNullFields) {
    const value = body[field]
    if (value !== undefined && value !== null && typeof value !== 'string') {
      return Response.json(
        { error: `${field} must be a string or null` },
        { status: 400 },
      )
    }
  }

  const nextModules = isRecord(agent.modules) ? { ...agent.modules } : {}
  const nextMemory: Record<string, unknown> = isRecord(nextModules.memory)
    ? { ...nextModules.memory }
    : { scheme: 'sqlite' }
  const nextValues = {
    summarizeModel: hasOwn(body, 'summarizeModel') ? readOptionalText(body.summarizeModel) : undefined,
    embeddingModel: hasOwn(body, 'embeddingModel') ? readOptionalText(body.embeddingModel) : undefined,
    shortTermRetrieveTopK: hasOwn(body, 'shortTermRetrieveTopK') ? readOptionalInt(body.shortTermRetrieveTopK) : undefined,
    fixedRetrieveTopK: hasOwn(body, 'fixedRetrieveTopK') ? readOptionalInt(body.fixedRetrieveTopK) : undefined,
    shortTermMinSimilarity: hasOwn(body, 'shortTermMinSimilarity') ? readOptionalProbability(body.shortTermMinSimilarity) : undefined,
    fixedMinSimilarity: hasOwn(body, 'fixedMinSimilarity') ? readOptionalProbability(body.fixedMinSimilarity) : undefined,
    semanticAnalyzerHistoryMessages: hasOwn(body, 'semanticAnalyzerHistoryMessages') ? readOptionalInt(body.semanticAnalyzerHistoryMessages) : undefined,
    longTermSearchDefaultTopK: hasOwn(body, 'longTermSearchDefaultTopK') ? readOptionalInt(body.longTermSearchDefaultTopK) : undefined,
    showNoHitMemoryFragments: hasOwn(body, 'showNoHitMemoryFragments') ? readOptionalBoolean(body.showNoHitMemoryFragments) : undefined,
    contextWindowMessages: hasOwn(body, 'contextWindowMessages') ? readOptionalInt(body.contextWindowMessages) : undefined,
    contextOverflowBatchSize: hasOwn(body, 'contextOverflowBatchSize') ? readOptionalInt(body.contextOverflowBatchSize) : undefined,
    contextIdleFlushMinutes: hasOwn(body, 'contextIdleFlushMinutes') ? readOptionalInt(body.contextIdleFlushMinutes) : undefined,
    maxShortTermMemoriesPerFlush: hasOwn(body, 'maxShortTermMemoriesPerFlush') ? readOptionalInt(body.maxShortTermMemoriesPerFlush) : undefined,
    sleepEnabled: hasOwn(body, 'sleepEnabled') ? (typeof body.sleepEnabled === 'boolean' ? body.sleepEnabled : null) : undefined,
    sleepTimeLocal: hasOwn(body, 'sleepTimeLocal') ? readOptionalText(body.sleepTimeLocal) : undefined,
    sleepIntervalDays: hasOwn(body, 'sleepIntervalDays') ? readOptionalInt(body.sleepIntervalDays) : undefined,
    semanticAnalyzerPrompt: hasOwn(body, 'semanticAnalyzerPrompt') ? readOptionalText(body.semanticAnalyzerPrompt) : undefined,
    contextToShortTermPrompt: hasOwn(body, 'contextToShortTermPrompt') ? readOptionalText(body.contextToShortTermPrompt) : undefined,
    shortTermToLongTermPrompt: hasOwn(body, 'shortTermToLongTermPrompt') ? readOptionalText(body.shortTermToLongTermPrompt) : undefined,
    fragmentPrompt: hasOwn(body, 'fragmentPrompt') ? readOptionalText(body.fragmentPrompt) : undefined,
    shortTermFragmentPrompt: hasOwn(body, 'shortTermFragmentPrompt') ? readOptionalText(body.shortTermFragmentPrompt) : undefined,
    fixedFragmentPrompt: hasOwn(body, 'fixedFragmentPrompt') ? readOptionalText(body.fixedFragmentPrompt) : undefined,
  }

  nextMemory.scheme = 'sqlite'
  delete nextMemory.retrievePrompt
  delete nextMemory.timeAnalyzerPrompt
  delete nextMemory.semanticAnalyzerMode
  delete nextMemory.summarizePrompt
  delete nextMemory.consolidatePrompt
  for (const [key, value] of Object.entries(nextValues)) {
    if (value === undefined) {
      continue
    }
    if (value !== null) {
      nextMemory[key] = value
    } else {
      delete nextMemory[key]
    }
  }
  nextModules.memory = nextMemory

  agentRepo.updateAgent(agentId, { modules: nextModules })
  const resolvedMemory = resolveMemorySqliteConfig(nextMemory)
  const resolvedPipeline = resolveMemoryPipelineSettings(nextMemory)

  return Response.json({
    agentId,
    scheme: 'sqlite',
    summarizeModel: resolvedMemory.summarizeModel,
    embeddingModel: resolvedMemory.embeddingModel,
    shortTermRetrieveTopK: resolvedMemory.shortTermRetrieveTopK,
    fixedRetrieveTopK: resolvedMemory.fixedRetrieveTopK,
    shortTermMinSimilarity: resolvedMemory.shortTermMinSimilarity,
    fixedMinSimilarity: resolvedMemory.fixedMinSimilarity,
    semanticAnalyzerHistoryMessages: resolvedMemory.semanticAnalyzerHistoryMessages,
    longTermSearchDefaultTopK: resolvedMemory.longTermSearchDefaultTopK,
    showNoHitMemoryFragments: resolvedMemory.showNoHitMemoryFragments,
    contextWindowMessages: resolvedPipeline.contextWindowMessages,
    contextOverflowBatchSize: resolvedPipeline.contextOverflowBatchSize,
    contextIdleFlushMinutes: resolvedPipeline.contextIdleFlushMinutes,
    maxShortTermMemoriesPerFlush: resolvedPipeline.maxShortTermMemoriesPerFlush,
    sleepEnabled: resolvedPipeline.sleepEnabled,
    sleepTimeLocal: resolvedPipeline.sleepTimeLocal,
    sleepIntervalDays: resolvedPipeline.sleepIntervalDays,
    semanticAnalyzerPrompt: resolvedMemory.semanticAnalyzerPrompt ?? resolvedMemory.retrievePrompt,
    contextToShortTermPrompt: resolvedMemory.contextToShortTermPrompt,
    shortTermToLongTermPrompt: resolvedMemory.shortTermToLongTermPrompt,
    fragmentPrompt: resolvedMemory.fragmentPrompt,
    shortTermFragmentPrompt: resolvedMemory.shortTermFragmentPrompt ?? resolvedMemory.fragmentPrompt,
    fixedFragmentPrompt: resolvedMemory.fixedFragmentPrompt ?? resolvedMemory.fragmentPrompt,
    semanticAnalyzerPromptDefault: buildSemanticAnalyzerPrompt(),
    semanticAnalyzerPromptEffective: buildSemanticAnalyzerPrompt(resolvedMemory.semanticAnalyzerPrompt ?? resolvedMemory.retrievePrompt),
    contextToShortTermPromptDefault: buildContextToShortTermPrompt(null, resolvedPipeline.maxShortTermMemoriesPerFlush),
    contextToShortTermPromptEffective: buildContextToShortTermPrompt(
      resolvedMemory.contextToShortTermPrompt,
      resolvedPipeline.maxShortTermMemoriesPerFlush,
    ),
    shortTermToLongTermPromptDefault: buildShortTermToLongTermPrompt(null, resolvedPipeline.maxShortTermMemoriesPerFlush),
    shortTermToLongTermPromptEffective: buildShortTermToLongTermPrompt(
      resolvedMemory.shortTermToLongTermPrompt,
      resolvedPipeline.maxShortTermMemoriesPerFlush,
    ),
    fragmentPromptDefault: buildMemoryFragmentPrompt(),
    fragmentPromptEffective: buildMemoryFragmentPrompt(resolvedMemory.fragmentPrompt),
    shortTermFragmentPromptDefault: buildShortTermFragmentPrompt(),
    shortTermFragmentPromptEffective: buildShortTermFragmentPrompt(
      resolvedMemory.shortTermFragmentPrompt ?? resolvedMemory.fragmentPrompt,
    ),
    fixedFragmentPromptDefault: buildFixedMemoryFragmentPrompt(),
    fixedFragmentPromptEffective: buildFixedMemoryFragmentPrompt(
      resolvedMemory.fixedFragmentPrompt ?? resolvedMemory.fragmentPrompt,
    ),
  })
}
