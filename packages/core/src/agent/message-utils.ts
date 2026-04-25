import { COMPACTION_SUMMARY_PREFIX } from '@mas/systems'
import type { ConversationMessage } from '@mas/systems'
import type { Message } from '../types'

export function extractContentText(
  content: Message['content'] | ConversationMessage['content'],
): string {
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

export function cloneMessages(messages: Message[]): Message[] {
  return JSON.parse(JSON.stringify(messages))
}

export function createSummaryMessage(summaryText: string): Message {
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
