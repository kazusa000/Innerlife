import type { DaemonEventView, DaemonOverviewData } from './types'

export function getDaemonHeadline(daemon: DaemonOverviewData['daemon']) {
  return daemon?.status === 'running' ? 'Daemon 在线' : 'Daemon 离线'
}

export function formatDaemonEventLine(event: DaemonEventView) {
  const time = new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(event.createdAt))

  return `[${time}] [${event.scope}] ${event.message}`
}
