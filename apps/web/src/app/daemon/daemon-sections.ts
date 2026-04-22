export type DaemonSectionId = 'overview' | 'turing' | 'flush' | 'sleep' | 'events'

export interface DaemonSection {
  id: DaemonSectionId
  anchor: string
  label: string
  description: string
}

const DAEMON_SECTIONS: DaemonSection[] = [
  { id: 'overview', anchor: 'daemon-section-overview', label: '概览', description: '运行状态' },
  { id: 'turing', anchor: 'daemon-section-turing', label: '图灵测试', description: '最近 run' },
  { id: 'flush', anchor: 'daemon-section-flush', label: '记忆 Flush', description: 'context → STM' },
  { id: 'sleep', anchor: 'daemon-section-sleep', label: '睡眠', description: 'STM → LTM' },
  { id: 'events', anchor: 'daemon-section-events', label: '事件流', description: '后台日志' },
]

export function getDaemonSections() {
  return DAEMON_SECTIONS
}
