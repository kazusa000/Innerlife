export type DaemonSectionId = 'overview' | 'turing' | 'flush' | 'sleep' | 'events'

export interface DaemonSection {
  id: DaemonSectionId
  anchor: string
  label: string
  description: string
}

export interface DaemonNavLeaf {
  id: DaemonSectionId
  anchor: string
  label: string
  description: string
}

export interface DaemonNavLinkGroup {
  id: 'overview' | 'events'
  anchor: string
  label: string
  description: string
}

export interface DaemonNavFeatureGroup {
  id: 'features'
  label: string
  description: string
  children: DaemonNavLeaf[]
}

export type DaemonNavGroup = DaemonNavLinkGroup | DaemonNavFeatureGroup

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

export function getDaemonNavGroups(): DaemonNavGroup[] {
  const overviewSection = DAEMON_SECTIONS.find((section) => section.id === 'overview')!
  const eventsSection = DAEMON_SECTIONS.find((section) => section.id === 'events')!
  const features = DAEMON_SECTIONS.filter((section) => (
    section.id === 'turing' || section.id === 'flush' || section.id === 'sleep'
  ))

  return [
    {
      id: 'overview',
      label: overviewSection.label,
      description: overviewSection.description,
      anchor: overviewSection.anchor,
    },
    {
      id: 'events',
      label: eventsSection.label,
      description: eventsSection.description,
      anchor: eventsSection.anchor,
    },
    {
      id: 'features',
      label: '功能',
      description: '图灵测试 / Flush / 睡眠',
      children: features,
    },
  ]
}
