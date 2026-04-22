import { createProvider, type Message } from '@mas/core'
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
  buildContextToShortTermSourceText,
  buildShortTermToLongTermPrompt,
  buildShortTermToLongTermSourceText,
  type ConversationMessage,
  createOpenRouterMemoryEmbedder,
  DEFAULT_MEMORY_EMBEDDING_MODEL,
  isSqliteMemoryConfig,
  MEMORY_BATCH_WRITE_RESPONSE_FORMAT,
  parseMemoryBatchWriteResponse,
  resolveMemoryPipelineSettings,
  resolveMemorySqliteConfig,
} from '@mas/systems'

type DbMessage = ReturnType<typeof messageRepo.getSessionMessages>[number]

function toConversationMessage(message: DbMessage): ConversationMessage {
  return {
    role: message.role as ConversationMessage['role'],
    content: JSON.parse(message.content) as Message['content'],
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
  embeddingModel: string
}) {
  const embedder = createOpenRouterMemoryEmbedder()
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
    displaySummary: memory.displaySummary,
    retrievalText: memory.retrievalText,
    retrievalEmbedding: embeddings[index] ?? [],
    retrievalModel: input.embeddingModel || DEFAULT_MEMORY_EMBEDDING_MODEL,
    tags: memory.tags,
    importance: memory.importance,
  }))
}

export async function runContextFlushForSession(input: {
  sessionId: string
  mode?: 'idle' | 'overflow' | 'manual'
  now?: Date
  signal?: AbortSignal
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
  const settings = resolveMemoryPipelineSettings(agent.modules?.memory)
  const memoryConfig = resolveMemorySqliteConfig(agent.modules?.memory)
  const dbMessages = messageRepo.getSessionMessages(input.sessionId)
  if (dbMessages.length === 0) {
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
    return { ok: false as const, reason: 'no_active_context' as const }
  }

  let candidateMessages: DbMessage[] = []
  const mode = input.mode ?? 'manual'
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
      return { ok: false as const, reason: 'not_idle_enough' as const }
    }
    candidateMessages = activeMessages
  } else {
    candidateMessages = activeMessages.length > settings.contextWindowMessages
      ? selectOverflowCandidate(activeMessages, settings.contextWindowMessages, settings.contextOverflowBatchSize)
      : activeMessages
  }

  if (candidateMessages.length === 0) {
    return { ok: false as const, reason: 'nothing_to_flush' as const }
  }

  const provider = createProvider(agent.provider)
  const sourceText = buildContextToShortTermSourceText(candidateMessages.map(toConversationMessage))
  const response = await provider.sendMessage({
    model: memoryConfig.summarizeModel ?? agent.model,
    systemPrompt: buildContextToShortTermPrompt(
      memoryConfig.contextToShortTermPrompt ?? memoryConfig.summarizePrompt,
      settings.maxShortTermMemoriesPerFlush,
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
    embeddingModel: memoryConfig.embeddingModel,
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
}) {
  const agent = agentRepo.getAgent(input.agentId)
  if (!agent || !isSqliteMemoryConfig(agent.modules?.memory)) {
    return { ok: false as const, reason: 'memory_not_sqlite' as const }
  }

  const now = input.now ?? new Date()
  const settings = resolveMemoryPipelineSettings(agent.modules?.memory)
  if (!settings.sleepEnabled && input.mode !== 'manual') {
    return { ok: false as const, reason: 'sleep_disabled' as const }
  }

  const sleepState = agentMemorySleepStateRepo.getAgentMemorySleepState(agent.id)
  if (input.mode !== 'manual' && !isSleepDue({
    lastSleepAt: sleepState?.lastSleepAt ?? null,
    now,
    sleepTimeLocal: settings.sleepTimeLocal,
    sleepIntervalDays: settings.sleepIntervalDays,
  })) {
    return { ok: false as const, reason: 'not_sleep_time' as const }
  }

  const memoryConfig = resolveMemorySqliteConfig(agent.modules?.memory)
  const shortTermMemories = memoryRepo
    .listMemoriesByAgentOldestFirst(agent.id)
    .filter((memory) => memory.layer === 'short_term')

  if (shortTermMemories.length === 0) {
    agentMemorySleepStateRepo.upsertAgentMemorySleepState({
      agentId: agent.id,
      lastSleepAt: now,
    })
    return { ok: true as const, createdCount: 0, deletedShortTermCount: 0 }
  }

  const provider = createProvider(agent.provider)
  const sourceText = buildShortTermToLongTermSourceText(shortTermMemories)
  const response = await provider.sendMessage({
    model: memoryConfig.summarizeModel ?? agent.model,
    systemPrompt: buildShortTermToLongTermPrompt(
      memoryConfig.shortTermToLongTermPrompt ?? memoryConfig.consolidatePrompt,
      settings.maxShortTermMemoriesPerFlush,
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
    sessionId: shortTermMemories[0]!.sessionId,
    layer: 'long_term',
    sourceText,
    memoryWrites,
    embeddingModel: memoryConfig.embeddingModel,
  })

  for (const memory of shortTermMemories) {
    memoryRepo.deleteSqliteMemoryByAgent(agent.id, memory.id)
  }

  agentMemorySleepStateRepo.upsertAgentMemorySleepState({
    agentId: agent.id,
    lastSleepAt: now,
  })

  return {
    ok: true as const,
    createdCount: created.length,
    memoryIds: created.map((memory) => memory.id),
    deletedShortTermCount: shortTermMemories.length,
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
