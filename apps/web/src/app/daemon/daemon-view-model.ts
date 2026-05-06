import type { DaemonEventView, DaemonOverviewData } from './types'

export function getDaemonHeadline(daemon: DaemonOverviewData['daemon'], locale: 'zh-CN' | 'en-US' = 'zh-CN') {
  if (locale === 'en-US') {
    return daemon?.status === 'running' ? 'Daemon Online' : 'Daemon Offline'
  }
  return daemon?.status === 'running' ? 'Daemon 在线' : 'Daemon 离线'
}

function translateDaemonEventMessage(message: string, locale: 'zh-CN' | 'en-US') {
  if (locale !== 'en-US') {
    return message
  }

  const exact: Record<string, string> = {
    'daemon 已启动': 'daemon started',
    'daemon 正在停止': 'daemon stopping',
    'daemon 已停止': 'daemon stopped',
    'context flush 开始': 'context flush started',
    'context flush 失败：没有消息': 'context flush failed: no messages',
    'context flush 失败：没有活跃 context': 'context flush failed: no active context',
    'context flush 跳过：尚未达到空闲阈值': 'context flush skipped: idle threshold not reached',
    'context flush 跳过：没有可搬运的旧 context': 'context flush skipped: no old context to move',
    'context flush 完成': 'context flush complete',
    'sleep 开始': 'sleep started',
    'sleep 跳过：功能未启用': 'sleep skipped: feature disabled',
    'sleep 跳过：尚未到睡眠时间': 'sleep skipped: sleep time not reached',
    'sleep 完成：没有可沉淀的短期记忆': 'sleep complete: no short-term memories to consolidate',
    'sleep 完成': 'sleep complete',
  }
  if (exact[message]) {
    return exact[message]
  }

  if (message.startsWith('daemon tick 失败：')) {
    return `daemon tick failed: ${message.slice('daemon tick 失败：'.length)}`
  }

  return message
}

export function formatDaemonEventLine(event: DaemonEventView, locale: 'zh-CN' | 'en-US' = 'zh-CN') {
  const time = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(event.createdAt))

  return `[${time}] [${event.scope}] ${translateDaemonEventMessage(event.message, locale)}`
}
