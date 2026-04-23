import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildContextResetNotice,
  buildContextResetRequestBody,
  getContextResetButtonLabel,
  getContextResetLoadingLabel,
} from './context-reset'

test('getContextResetButtonLabel upgrades the sqlite copy', () => {
  assert.equal(getContextResetButtonLabel('sqlite'), '清除上下文并撰写短期记忆')
  assert.equal(getContextResetButtonLabel('noop'), '清除上下文')
  assert.equal(getContextResetButtonLabel(null), '清除上下文')
})

test('getContextResetLoadingLabel stays scheme-specific', () => {
  assert.equal(getContextResetLoadingLabel('sqlite'), '正在清除上下文并撰写短期记忆…')
  assert.equal(getContextResetLoadingLabel('noop'), '正在清除上下文…')
})

test('buildContextResetRequestBody only enables flushContext for sqlite agents', () => {
  assert.deepEqual(buildContextResetRequestBody('sqlite'), {
    reset: true,
    flushContext: true,
  })
  assert.deepEqual(buildContextResetRequestBody('noop'), {
    reset: true,
  })
})

test('buildContextResetNotice reports successful sqlite flushes with STM count', () => {
  assert.deepEqual(buildContextResetNotice({
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
    memoryScheme: 'sqlite',
    responseOk: false,
    responseError: 'Failed to flush active context',
  }), {
    tone: 'error',
    text: '整理旧上下文失败，因此没有执行清除。Failed to flush active context',
  })
})

test('buildContextResetNotice reports non-sqlite reset success with the old copy', () => {
  assert.deepEqual(buildContextResetNotice({
    memoryScheme: 'noop',
    responseOk: true,
  }), {
    tone: 'success',
    text: '已清除上下文，并切到新的对话章节。',
  })
})
