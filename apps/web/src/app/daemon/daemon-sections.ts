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

const DAEMON_SECTIONS_BY_LOCALE: Record<'zh-CN' | 'en-US', DaemonSection[]> = {
  'zh-CN': [
  { id: 'overview', anchor: 'daemon-section-overview', label: '概览', description: '运行状态' },
  { id: 'turing', anchor: 'daemon-section-turing', label: '图灵测试', description: '最近 run' },
  { id: 'flush', anchor: 'daemon-section-flush', label: '记忆 Flush', description: 'context → STM' },
  { id: 'sleep', anchor: 'daemon-section-sleep', label: '睡眠', description: 'STM → LTM' },
  { id: 'events', anchor: 'daemon-section-events', label: '事件流', description: '后台日志' },
  ],
  'en-US': [
    { id: 'overview', anchor: 'daemon-section-overview', label: 'Overview', description: 'Runtime state' },
    { id: 'turing', anchor: 'daemon-section-turing', label: 'Turing Tests', description: 'Recent runs' },
    { id: 'flush', anchor: 'daemon-section-flush', label: 'Memory Flush', description: 'context → STM' },
    { id: 'sleep', anchor: 'daemon-section-sleep', label: 'Sleep', description: 'STM → LTM' },
    { id: 'events', anchor: 'daemon-section-events', label: 'Event Stream', description: 'Background log' },
  ],
}

export function getDaemonSections(locale: 'zh-CN' | 'en-US' = 'zh-CN') {
  return DAEMON_SECTIONS_BY_LOCALE[locale]
}

export function getDaemonNavGroups(locale: 'zh-CN' | 'en-US' = 'zh-CN'): DaemonNavGroup[] {
  const sections = getDaemonSections(locale)
  const overviewSection = sections.find((section) => section.id === 'overview')!
  const eventsSection = sections.find((section) => section.id === 'events')!
  const features = sections.filter((section) => (
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
      label: locale === 'en-US' ? 'Features' : '功能',
      description: locale === 'en-US' ? 'Turing Tests / Flush / Sleep' : '图灵测试 / Flush / 睡眠',
      children: features,
    },
  ]
}
