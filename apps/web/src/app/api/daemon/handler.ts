import { runContextFlushForSession, runSleepForAgent } from '@mas/daemon'
import {
  agentMemorySleepStateRepo,
  agentRepo,
  daemonEventRepo,
  daemonStateRepo,
  memoryRepo,
  messageRepo,
  sessionContextStateRepo,
  sessionRepo,
} from '@mas/db'
import { isSqliteMemoryConfig, resolveMemoryPipelineSettings } from '@mas/systems'
import {
  serializeDaemonEventList,
  serializeDaemonState,
} from './shared'

const DEFAULT_TICK_INTERVAL_MS = 5_000

function readTickIntervalMs() {
  const raw = process.env.MAS_DAEMON_TICK_INTERVAL_MS?.trim()
  if (!raw) {
    return DEFAULT_TICK_INTERVAL_MS
  }

  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TICK_INTERVAL_MS
}

function readActiveMessages(messages: ReturnType<typeof messageRepo.getSessionMessages>, activeStartMessageId: string | null | undefined) {
  if (activeStartMessageId === null) {
    return []
  }
  if (!activeStartMessageId) {
    return messages
  }

  const startIndex = messages.findIndex((message) => message.id === activeStartMessageId)
  return startIndex >= 0 ? messages.slice(startIndex) : messages
}

function resolveLastUserMessageAt(
  state: ReturnType<typeof sessionContextStateRepo.getSessionContextState> | undefined,
  messages: ReturnType<typeof messageRepo.getSessionMessages>,
) {
  if (state?.lastUserMessageAt) {
    return state.lastUserMessageAt
  }

  return messages
    .filter((message) => message.role === 'user')
    .at(-1)?.createdAt ?? null
}

function determineFlushReason(input: {
  activeMessageCount: number
  contextWindowMessages: number
  lastUserMessageAt: Date | null
  idleFlushMinutes: number
  now: Date
}) {
  if (input.activeMessageCount > input.contextWindowMessages) {
    return 'overflow'
  }

  if (!input.lastUserMessageAt) {
    return null
  }

  const idleMs = input.idleFlushMinutes * 60 * 1000
  return input.now.getTime() - input.lastUserMessageAt.getTime() >= idleMs
    ? 'idle'
    : null
}

function isSleepDue(input: {
  lastSleepAt: Date | null
  now: Date
  sleepTimeLocal: string
  sleepIntervalDays: number
}) {
  const [hours, minutes] = input.sleepTimeLocal.split(':').map((value) => Number(value))
  const scheduled = new Date(input.now)
  scheduled.setHours(hours ?? 0, minutes ?? 0, 0, 0)

  if (input.now.getTime() < scheduled.getTime()) {
    return false
  }

  if (!input.lastSleepAt) {
    return true
  }

  const elapsed = input.now.getTime() - input.lastSleepAt.getTime()
  const required = input.sleepIntervalDays * 24 * 60 * 60 * 1000
  return elapsed >= required && input.lastSleepAt.getTime() < scheduled.getTime()
}

export async function getDaemonOverview() {
  const events = daemonEventRepo.listEvents({ limit: 20 })
  const counts = {
    total: events.length,
    daemon: events.filter((event) => event.scope === 'daemon').length,
    memoryFlush: events.filter((event) => event.scope === 'memory_flush').length,
    memorySleep: events.filter((event) => event.scope === 'memory_sleep').length,
  }

  return Response.json({
    daemon: serializeDaemonState(daemonStateRepo.getDaemonState()),
    tickIntervalMs: readTickIntervalMs(),
    recentEventCounts: counts,
  })
}

export async function getDaemonEventsFeed() {
  const events = daemonEventRepo.listEvents({ limit: 40 })
  return Response.json({
    events: serializeDaemonEventList(events),
  })
}

export async function getDaemonContextFlushList(
  input: {
    now?: Date
  } = {},
) {
  const now = input.now ?? new Date()
  const sessions = sessionRepo.listAllSessions()
    .filter((session) => session.status === 'active')

  const items = sessions.flatMap((session) => {
    const agent = agentRepo.getAgent(session.agentId)
    if (!agent || !isSqliteMemoryConfig(agent.modules?.memory)) {
      return []
    }

    const settings = resolveMemoryPipelineSettings(agent.modules?.memory)
    const messages = messageRepo.getSessionMessages(session.id)
    const state = sessionContextStateRepo.getSessionContextState(session.id)
    const defaultActiveStart = state
      ? state.activeStartMessageId
      : (messages[0]?.id ?? null)
    const activeMessages = readActiveMessages(messages, defaultActiveStart)
    const lastUserMessageAt = resolveLastUserMessageAt(state, messages)
    const flushReason = determineFlushReason({
      activeMessageCount: activeMessages.length,
      contextWindowMessages: settings.contextWindowMessages,
      lastUserMessageAt,
      idleFlushMinutes: settings.contextIdleFlushMinutes,
      now,
    })

    return [{
      sessionId: session.id,
      sessionTitle: session.title ?? null,
      agentId: agent.id,
      agentName: agent.name,
      activeStartMessageId: defaultActiveStart,
      pendingFlushUntilMessageId: state?.pendingFlushUntilMessageId ?? null,
      activeMessageCount: activeMessages.length,
      totalSessionMessages: messages.length,
      lastUserMessageAt: lastUserMessageAt?.toISOString() ?? null,
      lastContextFlushAt: state?.lastContextFlushAt?.toISOString() ?? null,
      canFlush: flushReason !== null,
      flushReason,
    }]
  })

  return Response.json({
    sessions: items,
  })
}

export async function runDaemonContextFlush(
  body: {
    sessionId?: string
  },
  deps: {
    runContextFlushForSession?: (input: {
      sessionId: string
      mode?: 'idle' | 'overflow' | 'manual'
      now?: Date
      signal?: AbortSignal
    }) => Promise<unknown>
  } = {},
) {
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
  if (!sessionId) {
    return Response.json({ error: 'sessionId is required' }, { status: 400 })
  }

  const runFlush = deps.runContextFlushForSession ?? runContextFlushForSession
  const result = await runFlush({
    sessionId,
    mode: 'manual',
  })

  return Response.json({
    sessionId,
    result,
  })
}

export async function getDaemonSleepList(
  input: {
    now?: Date
  } = {},
) {
  const now = input.now ?? new Date()
  const agents = agentRepo.listAgents()
    .filter((agent) => isSqliteMemoryConfig(agent.modules?.memory))

  const items = agents.map((agent) => {
    const settings = resolveMemoryPipelineSettings(agent.modules?.memory)
    const shortTermCount = memoryRepo
      .listMemoriesByAgent(agent.id)
      .filter((memory) => memory.layer === 'short_term')
      .length
    const sleepState = agentMemorySleepStateRepo.getAgentMemorySleepState(agent.id)
    const lastRelatedEvent = daemonEventRepo.listEvents({ scope: 'memory_sleep', limit: 20 })
      .find((event) => event.payload?.agentId === agent.id)

    return {
      agentId: agent.id,
      agentName: agent.name,
      shortTermCount,
      sleepEnabled: settings.sleepEnabled,
      sleepTimeLocal: settings.sleepTimeLocal,
      sleepIntervalDays: settings.sleepIntervalDays,
      lastSleepAt: sleepState?.lastSleepAt?.toISOString() ?? null,
      lastSleepEventAt: lastRelatedEvent?.createdAt.toISOString() ?? null,
      canSleep: shortTermCount > 0 && isSleepDue({
        lastSleepAt: sleepState?.lastSleepAt ?? null,
        now,
        sleepTimeLocal: settings.sleepTimeLocal,
        sleepIntervalDays: settings.sleepIntervalDays,
      }),
    }
  })

  return Response.json({
    agents: items,
  })
}

export async function runDaemonSleep(
  body: {
    agentId?: string
  },
  deps: {
    runSleepForAgent?: (input: {
      agentId: string
      mode?: 'scheduled' | 'manual'
      now?: Date
      signal?: AbortSignal
    }) => Promise<unknown>
  } = {},
) {
  const agentId = typeof body.agentId === 'string' ? body.agentId : ''
  if (!agentId) {
    return Response.json({ error: 'agentId is required' }, { status: 400 })
  }

  const runSleep = deps.runSleepForAgent ?? runSleepForAgent
  const result = await runSleep({
    agentId,
    mode: 'manual',
  })

  return Response.json({
    agentId,
    result,
  })
}
