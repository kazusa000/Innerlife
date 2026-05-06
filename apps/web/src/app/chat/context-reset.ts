export interface ContextFlushSuccessResult {
  ok: true
  mode: 'manual'
  createdCount: number
  memoryIds: string[]
  nextActiveStartMessageId: string | null
  flushedMessageCount: number
}

export interface ContextFlushSkippedResult {
  ok: false
  reason: string
}

export type ContextFlushResult = ContextFlushSuccessResult | ContextFlushSkippedResult
export type ContextResetMode = 'clear' | 'flush'

export interface ContextResetResponse {
  session: {
    id: string
  }
  contextFlush?: ContextFlushResult
}

export interface ContextResetNotice {
  tone: 'success' | 'error'
  text: string
}

export function getContextResetButtonLabel(
  mode: ContextResetMode,
  memoryScheme?: string | null,
  locale: 'zh-CN' | 'en-US' = 'zh-CN',
) {
  if (locale === 'en-US') {
    return mode === 'flush' && memoryScheme === 'sqlite'
      ? 'Clear Context and Write Short-Term Memory'
      : 'Clear Context'
  }
  return mode === 'flush' && memoryScheme === 'sqlite'
    ? '清除上下文并撰写短期记忆'
    : '清除上下文'
}

export function getContextResetLoadingLabel(
  mode: ContextResetMode,
  memoryScheme?: string | null,
  locale: 'zh-CN' | 'en-US' = 'zh-CN',
) {
  if (locale === 'en-US') {
    return mode === 'flush' && memoryScheme === 'sqlite'
      ? 'Clearing context and writing short-term memory...'
      : 'Clearing context...'
  }
  return mode === 'flush' && memoryScheme === 'sqlite'
    ? '正在清除上下文并撰写短期记忆…'
    : '正在清除上下文…'
}

export function buildContextResetRequestBody(
  mode: ContextResetMode,
  memoryScheme?: string | null,
) {
  return mode === 'flush' && memoryScheme === 'sqlite'
    ? { reset: true, flushContext: true }
    : { reset: true }
}

export function buildContextResetNotice(input: {
  mode: ContextResetMode
  memoryScheme?: string | null
  responseOk: boolean
  responseError?: string | null
  contextFlush?: ContextFlushResult
  locale?: 'zh-CN' | 'en-US'
}): ContextResetNotice {
  const locale = input.locale ?? 'zh-CN'
  if (!input.responseOk) {
    if (input.mode === 'flush' && input.memoryScheme === 'sqlite') {
      return {
        tone: 'error',
        text: locale === 'en-US'
          ? `Failed to organize old context, so nothing was cleared. ${input.responseError ?? 'Please try again later.'}`
          : `整理旧上下文失败，因此没有执行清除。${input.responseError ?? '请稍后再试。'}`,
      }
    }

    return {
      tone: 'error',
      text: input.responseError ?? (locale === 'en-US'
        ? 'Failed to clear context. Please try again later.'
        : '清除上下文失败，请稍后再试。'),
    }
  }

  if (input.memoryScheme !== 'sqlite') {
    return {
      tone: 'success',
      text: locale === 'en-US'
        ? 'Context cleared and moved to a new conversation chapter.'
        : '已清除上下文，并切到新的对话章节。',
    }
  }

  if (input.mode !== 'flush') {
    return {
      tone: 'success',
      text: locale === 'en-US'
        ? 'Context cleared and moved to a new conversation chapter.'
        : '已清除上下文，并切到新的对话章节。',
    }
  }

  if (input.contextFlush?.ok) {
    return {
      tone: 'success',
      text: locale === 'en-US'
        ? `Context cleared and ${input.contextFlush.createdCount} short-term memories were written.`
        : `已清除上下文，并写入 ${input.contextFlush.createdCount} 条短期记忆。`,
    }
  }

  return {
    tone: 'success',
    text: locale === 'en-US'
      ? 'No old context could be moved, but context was cleared and moved to a new conversation chapter.'
      : '没有可搬运的旧 context，但已经清除上下文并切到新的对话章节。',
  }
}
