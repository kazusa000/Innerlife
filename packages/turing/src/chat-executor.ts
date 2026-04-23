import {
  createProvider,
  getDefaultTools,
  runAgent,
  type AgentConfig,
  type AgentEvent,
  type ContentBlock,
  type Message,
} from '@mas/core'
import { agentRepo, messageRepo, sessionContextStateRepo, sessionRepo } from '@mas/db'
import { createDbObserver, createNoopObserver, type ObserverEvent } from '@mas/observer'
import { createSystems, isSqliteMemoryConfig } from '@mas/systems'

const INTERRUPTED_SUFFIX = ' —（中断）'
type DbMessageRecord = ReturnType<typeof messageRepo.getSessionMessages>[number]

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function extractAssistantText(content: ContentBlock[]): string {
  return content
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('')
}

function persistInterruptedMessage(sessionId: string, assistantText: string) {
  const content = assistantText
    ? `${assistantText}${INTERRUPTED_SUFFIX}`
    : '（中断）'

  messageRepo.addMessage({
    sessionId,
    role: 'assistant',
    content: JSON.stringify([{ type: 'text', text: content }]),
  })
}

function selectActiveDbMessages(
  dbMessages: DbMessageRecord[],
  activeStartMessageId: string | null | undefined,
) {
  if (!activeStartMessageId) {
    return []
  }

  const startIndex = dbMessages.findIndex((message) => message.id === activeStartMessageId)
  return startIndex >= 0 ? dbMessages.slice(startIndex) : dbMessages
}

function readPersonalityPrompts(modules: Record<string, unknown> | null | undefined) {
  const personality = isRecord(modules?.personality)
    ? modules?.personality as Record<string, unknown>
    : null

  return {
    systemPrompt:
      typeof personality?.systemPrompt === 'string' && personality.systemPrompt.trim().length > 0
        ? personality.systemPrompt.trim()
        : '',
    personaPrompt:
      typeof personality?.personaPrompt === 'string' && personality.personaPrompt.trim().length > 0
        ? personality.personaPrompt.trim()
        : '',
  }
}

export function buildAgentSystemPrompt(agent: {
  name: string
  description: string | null
  modules?: Record<string, unknown> | null
}) {
  const memoryIsSqlite = isSqliteMemoryConfig(agent.modules?.memory)
  const toolPrompt = memoryIsSqlite
    ? 'You can use the web_fetch tool to fetch web pages. If current context, short-term memory, and fixed memory are still insufficient, you may use search_long_term_memory once to look up long-term memories. Be concise.'
    : 'You can use the web_fetch tool to fetch web pages. Be concise.'
  const persona = readPersonalityPrompts(agent.modules)
  const basePrompt = persona.systemPrompt
    || (agent.description
      ? `You are ${agent.name}. ${agent.description}.`
      : `You are ${agent.name}.`)
  const rolePrompt = persona.personaPrompt

  return [
    basePrompt,
    rolePrompt ? `角色额外约束：${rolePrompt}` : null,
    toolPrompt,
  ].filter(Boolean).join('\n\n')
}

export async function executeChatTurn(input: {
  sessionId: string
  userMessage: string
  onEvent?: (event: AgentEvent | ObserverEvent | { type: 'turn_start' | 'turn_end'; payload: Record<string, unknown> }) => void
  signal?: AbortSignal
  observerMode?: 'auto' | 'always' | 'off'
}) {
  const userMessageId = messageRepo.addMessage({
    sessionId: input.sessionId,
    role: 'user',
    content: JSON.stringify([{ type: 'text', text: input.userMessage }]),
  })

  const session = sessionRepo.getSession(input.sessionId)
  const agent = session ? agentRepo.getAgent(session.agentId) : null
  if (!agent) {
    throw new Error(`Agent for session ${input.sessionId} was not found`)
  }

  const dbMessages = messageRepo.getSessionMessages(input.sessionId)
  const memoryIsSqlite = isSqliteMemoryConfig(agent.modules?.memory)
  let activeDbMessages = dbMessages

  if (memoryIsSqlite) {
    const existingState = sessionContextStateRepo.getSessionContextState(input.sessionId)
    const nextActiveStartMessageId = existingState
      ? (existingState.activeStartMessageId ?? userMessageId)
      : (dbMessages[0]?.id ?? userMessageId)

    sessionContextStateRepo.upsertSessionContextState({
      sessionId: input.sessionId,
      activeStartMessageId: nextActiveStartMessageId,
      lastUserMessageAt: new Date(),
    })

    activeDbMessages = selectActiveDbMessages(dbMessages, nextActiveStartMessageId)
  }

  const messages: Message[] = activeDbMessages.map((message) => ({
    role: message.role as Message['role'],
    content: JSON.parse(message.content),
  }))

  const provider = createProvider(agent.provider)
  const tools = getDefaultTools()
  const systems = createSystems(agent.modules ?? null)
  const config: AgentConfig = {
    id: agent.id,
    model: agent.model,
    systemPrompt: buildAgentSystemPrompt(agent),
    tools,
    maxTurns: 10,
    sessionId: input.sessionId,
    userId: 'default-user',
  }

  let assistantText = ''
  let turnStatus: 'complete' | 'aborted' | 'error' = 'complete'
  let responseContent: ContentBlock[] = []
  input.onEvent?.({
    type: 'turn_start',
    payload: {
      sessionId: input.sessionId,
      agentId: agent.id,
    },
  })

  const shouldObserve = input.observerMode === 'always'
    || (input.observerMode !== 'off' && process.env.OBSERVER_ENABLED === '1')

  const observer =
    shouldObserve
      ? createDbObserver({
          sessionId: input.sessionId,
          userMessageId,
          model: config.model,
          onEvent: (event) => input.onEvent?.(event),
        })
      : createNoopObserver()

  try {
    for await (const event of runAgent(
      config,
      messages,
      provider,
      systems,
      observer,
      input.signal,
    )) {
      if (event.type === 'text_delta') {
        assistantText += event.text
      }

      input.onEvent?.(event)

      if (event.type === 'complete') {
        responseContent = event.response.content
        messageRepo.addMessage({
          sessionId: input.sessionId,
          role: 'assistant',
          content: JSON.stringify(event.response.content),
          tokenCount: event.response.usage.outputTokens,
        })
        assistantText = ''
        turnStatus = 'complete'
      }

      if (event.type === 'aborted') {
        persistInterruptedMessage(input.sessionId, assistantText)
        turnStatus = 'aborted'
      }

      if (event.type === 'error') {
        turnStatus = 'error'
      }
    }
  } finally {
    input.onEvent?.({
      type: 'turn_end',
      payload: {
        sessionId: input.sessionId,
        status: turnStatus,
      },
    })
  }

  return {
    status: turnStatus,
    responseText: responseContent.length > 0 ? extractAssistantText(responseContent) : assistantText,
    responseContent,
    userMessageId,
  }
}
