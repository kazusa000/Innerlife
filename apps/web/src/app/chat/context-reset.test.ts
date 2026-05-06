import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildContextResetNotice,
  buildContextResetRequestBody,
  getContextResetButtonLabel,
  getContextResetLoadingLabel,
} from './context-reset'

test('getContextResetButtonLabel supports clear and flush modes', () => {
  assert.equal(getContextResetButtonLabel('clear', 'sqlite'), '清除上下文')
  assert.equal(getContextResetButtonLabel('flush', 'sqlite'), '清除上下文并撰写短期记忆')
  assert.equal(getContextResetButtonLabel('clear', 'noop'), '清除上下文')
  assert.equal(getContextResetButtonLabel('flush', 'noop'), '清除上下文')
  assert.equal(getContextResetButtonLabel('clear', null), '清除上下文')
  assert.equal(getContextResetButtonLabel('flush', 'sqlite', 'en-US'), 'Clear Context and Write Short-Term Memory')
})

test('getContextResetLoadingLabel supports clear and flush modes', () => {
  assert.equal(getContextResetLoadingLabel('clear', 'sqlite'), '正在清除上下文…')
  assert.equal(getContextResetLoadingLabel('flush', 'sqlite'), '正在清除上下文并撰写短期记忆…')
  assert.equal(getContextResetLoadingLabel('clear', 'noop'), '正在清除上下文…')
})

test('buildContextResetRequestBody only enables flushContext for sqlite flush mode', () => {
  assert.deepEqual(buildContextResetRequestBody('clear', 'sqlite'), {
    reset: true,
  })
  assert.deepEqual(buildContextResetRequestBody('flush', 'sqlite'), {
    reset: true,
    flushContext: true,
  })
  assert.deepEqual(buildContextResetRequestBody('flush', 'noop'), {
    reset: true,
  })
})

test('buildContextResetNotice reports successful sqlite flushes with STM count', () => {
  assert.deepEqual(buildContextResetNotice({
    mode: 'flush',
    memoryScheme: 'sqlite',
    responseOk: true,
    locale: 'en-US',
    contextFlush: {
      ok: true,
      mode: 'manual',
      createdCount: 2,
      memoryIds: ['memory-1', 'memory-2'],
      nextActiveStartMessageId: 'message-9',
      flushedMessageCount: 8,
    },
  }), {
    tone: 'success',
    text: 'Context cleared and 2 short-term memories were written.',
  })
})

test('buildContextResetNotice reports successful sqlite flushes with STM count in zh-CN by default', () => {
  assert.deepEqual(buildContextResetNotice({
    mode: 'flush',
    memoryScheme: 'sqlite',
    responseOk: true,
    contextFlush: {
      ok: true,
      mode: 'manual',
      createdCount: 2,
      memoryIds: ['memory-1', 'memory-2'],
      nextActiveStartMessageId: 'message-9',
      flushedMessageCount: 8,
    },
  }), {
    tone: 'success',
    text: '已清除上下文，并写入 2 条短期记忆。',
  })
})

test('buildContextResetNotice reports soft sqlite flush results without failing reset', () => {
  assert.deepEqual(buildContextResetNotice({
    mode: 'flush',
    memoryScheme: 'sqlite',
    responseOk: true,
    contextFlush: {
      ok: false,
      reason: 'nothing_to_flush',
    },
  }), {
    tone: 'success',
    text: '没有可搬运的旧 context，但已经清除上下文并切到新的对话章节。',
  })
})

test('buildContextResetNotice reports sqlite hard failures without claiming reset happened', () => {
  assert.deepEqual(buildContextResetNotice({
    mode: 'flush',
    memoryScheme: 'sqlite',
    responseOk: false,
    responseError: 'Failed to flush active context',
  }), {
    tone: 'error',
    text: '整理旧上下文失败，因此没有执行清除。Failed to flush active context',
  })
})

test('buildContextResetNotice reports plain reset success for sqlite and non-sqlite', () => {
  assert.deepEqual(buildContextResetNotice({
    mode: 'clear',
    memoryScheme: 'sqlite',
    responseOk: true,
  }), {
    tone: 'success',
    text: '已清除上下文，并切到新的对话章节。',
  })
  assert.deepEqual(buildContextResetNotice({
    mode: 'clear',
    memoryScheme: 'noop',
    responseOk: true,
  }), {
    tone: 'success',
    text: '已清除上下文，并切到新的对话章节。',
  })
})

test('buildContextResetNotice reports plain reset failures without flush wording', () => {
  assert.deepEqual(buildContextResetNotice({
    mode: 'clear',
    memoryScheme: 'sqlite',
    responseOk: false,
    responseError: '清除上下文失败，请稍后再试。',
  }), {
    tone: 'error',
    text: '清除上下文失败，请稍后再试。',
  })
})
