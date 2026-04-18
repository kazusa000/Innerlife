import type { AgentSystem, ConversationBlock, ConversationMessage, PendingCompaction, TurnContext } from '../types'

export const DEFAULT_MAX_MESSAGES = 40
export const DEFAULT_KEEP_RECENT_MESSAGES = 20
export const DEFAULT_MAX_INPUT_TOKENS = 12_000
export const COMPACTION_SUMMARY_PREFIX = 'Conversation summary:'

function estimateTokens(messages: ConversationMessage[]): number {
  const chars = messages.reduce((total, message) => total + estimateContentChars(message.content), 0)
  return Math.ceil(chars / 4)
}

function estimateContentChars(content: ConversationMessage['content']): number {
  if (typeof content === 'string') {
    return content.length
  }

  return content.reduce((total, block) => total + estimateBlockChars(block), 0)
}

function estimateBlockChars(block: ConversationBlock): number {
  return JSON.stringify(block).length
}

function buildSummaryPrompt(): string {
  return [
    'You compress earlier conversation history into a durable summary for later turns.',
    'Use only the information present in the provided messages.',
    'Keep the summary concise and factual.',
    'Return plain text under exactly these headings:',
    'Key facts',
    'User preferences',
    'Unresolved tasks',
    'Important recent context',
  ].join('\n')
}

function isCompactionSummaryMessage(message: ConversationMessage): boolean {
  if (message.role !== 'system') {
    return false
  }

  return extractMessageText(message).startsWith(COMPACTION_SUMMARY_PREFIX)
}

function extractMessageText(message: ConversationMessage): string {
  if (typeof message.content === 'string') {
    return message.content
  }

  return message.content
    .map((block) => (block.type === 'text' && typeof block.text === 'string' ? block.text : ''))
    .join('\n')
}

function createPendingCompaction(
  messages: ConversationMessage[],
  reason: PendingCompaction['reason'],
): PendingCompaction | undefined {
  const sourceMessages = messages.slice(0, -DEFAULT_KEEP_RECENT_MESSAGES)
    .filter((message) => message.role !== 'system' || isCompactionSummaryMessage(message))
  const keepMessages = messages.slice(-DEFAULT_KEEP_RECENT_MESSAGES)

  if (sourceMessages.length === 0 || keepMessages.length === 0) {
    return undefined
  }

  return {
    kind: 'summary',
    reason,
    prompt: buildSummaryPrompt(),
    sourceMessages,
    keepMessages,
  }
}

export class SummaryCompactionSystem implements AgentSystem {
  name = 'compaction:summary'
  type = 'compaction'

  async beforeLLM(ctx: TurnContext): Promise<void> {
    if (ctx.pendingCompaction || ctx.messages.length <= DEFAULT_KEEP_RECENT_MESSAGES) {
      return
    }

    if (ctx.messages.length > DEFAULT_MAX_MESSAGES) {
      ctx.pendingCompaction = createPendingCompaction(ctx.messages, {
        type: 'message_count',
        messageCount: ctx.messages.length,
      })
      return
    }

    const estimatedTokens = estimateTokens(ctx.messages)
    if (estimatedTokens > DEFAULT_MAX_INPUT_TOKENS) {
      ctx.pendingCompaction = createPendingCompaction(ctx.messages, {
        type: 'estimated_tokens',
        messageCount: ctx.messages.length,
        estimatedTokens,
      })
    }
  }
}
