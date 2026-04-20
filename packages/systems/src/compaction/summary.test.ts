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

function createSystemMessage(text: string): ConversationMessage {
  return {
    role: 'system',
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
    turnMetadata: {},
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
  assert.match(ctx.pendingCompaction?.prompt ?? '', /关键事实/)
  assert.match(ctx.pendingCompaction?.prompt ?? '', /用户偏好/)
  assert.match(ctx.pendingCompaction?.prompt ?? '', /未完成事项/)
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

test('summary compaction keeps the prior compaction summary in later compaction input', async () => {
  const system = new SummaryCompactionSystem()
  const ctx = createContext()
  ctx.messages = [
    createSystemMessage('Base system prompt that should not be compacted'),
    createSystemMessage('对话摘要：\n关键事实：旧摘要仍然保留'),
    ...Array.from({ length: 42 }, (_, index) => createMessage(index)),
  ]

  await system.beforeLLM?.(ctx)

  assert.equal(ctx.pendingCompaction?.kind, 'summary')
  assert.equal(
    ctx.pendingCompaction?.sourceMessages.some((message) => message.role === 'system'),
    true,
  )
  assert.deepEqual(
    ctx.pendingCompaction?.sourceMessages.filter((message) => message.role === 'system'),
    [createSystemMessage('对话摘要：\n关键事实：旧摘要仍然保留')],
  )
})
