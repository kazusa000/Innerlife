import {
  createProvider,
  getDefaultTools,
  runAgent,
  type AgentConfig,
  type AgentEvent,
  type ContentBlock,
  type Message,
} from '@mas/core'
import { agentRepo, messageRepo, sessionRepo } from '@mas/db'
import { createDbObserver, createNoopObserver, type ObserverEvent } from '@mas/observer'
import { createSystems } from '@mas/systems'

const INTERRUPTED_SUFFIX = ' —（中断）'

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

  const dbMessages = messageRepo.getSessionMessages(input.sessionId)
  const messages: Message[] = dbMessages.map((message) => ({
    role: message.role as Message['role'],
    content: JSON.parse(message.content),
  }))

  const session = sessionRepo.getSession(input.sessionId)
  const agent = session ? agentRepo.getAgent(session.agentId) : null
  if (!agent) {
    throw new Error(`Agent for session ${input.sessionId} was not found`)
  }

  const provider = createProvider(agent.provider)
  const tools = getDefaultTools()
  const systems = createSystems(agent.modules ?? null)
  const toolPrompt = 'You can use the web_fetch tool to fetch web pages. Be concise.'
  const config: AgentConfig = {
    id: agent.id,
    model: agent.model,
    systemPrompt: agent.description
      ? `You are ${agent.name}. ${agent.description}. ${toolPrompt}`
      : `You are a helpful AI assistant. ${toolPrompt}`,
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
