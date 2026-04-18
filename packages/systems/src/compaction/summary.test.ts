import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_KEEP_RECENT_MESSAGES,
  DEFAULT_MAX_INPUT_TOKENS,
  SummaryCompactionSystem,
} from './summary'
import type { ConversationMessage, TurnContext } from '../types'

function createMessage(index: number, text = `message ${index}`): ConversationMessage {
  return {
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: [{ type: 'text', text }],
  }
}

function createContext(messageCount = 0, text = 'hello'): TurnContext {
  return {
    agentId: 'agent-1',
    sessionId: 'session-1',
    userId: 'user-1',
    input: {
      raw: text,
      text,
      modality: 'text',
    },
    state: {},
    promptFragments: [],
    messages: Array.from({ length: messageCount }, (_, index) => createMessage(index)),
  }
}

test('summary compaction requests compaction when message count exceeds threshold', async () => {
  const system = new SummaryCompactionSystem()
  const ctx = createContext(41)

  await system.beforeLLM?.(ctx)

  assert.equal(ctx.pendingCompaction?.kind, 'summary')
  assert.equal(ctx.pendingCompaction?.reason.type, 'message_count')
  assert.equal(ctx.pendingCompaction?.keepMessages.length, DEFAULT_KEEP_RECENT_MESSAGES)
  assert.equal(
    ctx.pendingCompaction?.sourceMessages.length,
    ctx.messages.length - DEFAULT_KEEP_RECENT_MESSAGES,
  )
  assert.match(ctx.pendingCompaction?.prompt ?? '', /Key facts/i)
  assert.match(ctx.pendingCompaction?.prompt ?? '', /User preferences/i)
  assert.match(ctx.pendingCompaction?.prompt ?? '', /Unresolved tasks/i)
})

test('summary compaction requests compaction when estimated tokens exceed threshold', async () => {
  const system = new SummaryCompactionSystem()
  const longText = 'x'.repeat(DEFAULT_MAX_INPUT_TOKENS * 5)
  const ctx = createContext(25, longText)
  ctx.messages = Array.from({ length: 25 }, (_, index) => createMessage(index, longText))

  await system.beforeLLM?.(ctx)

  assert.equal(ctx.pendingCompaction?.kind, 'summary')
  assert.equal(ctx.pendingCompaction?.reason.type, 'estimated_tokens')
})
