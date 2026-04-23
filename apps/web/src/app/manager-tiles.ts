export type AgentManagerSection =
  | 'personality'
  | 'emotion'
  | 'relationships'
  | 'memory'
  | 'tools'
  | 'turing'

export interface AgentManagerTile {
  index: string
  title: string
  subtitle: string
  section: AgentManagerSection
}

export const AGENT_MANAGER_TILES: AgentManagerTile[] = [
  {
    index: '01',
    title: '人设',
    subtitle: 'system prompt、persona prompt',
    section: 'personality',
  },
  {
    index: '02',
    title: '情绪',
    subtitle: '状态、衰减、分析',
    section: 'emotion',
  },
  {
    index: '03',
    title: '关系',
    subtitle: '连结、信任、历史',
    section: 'relationships',
  },
  {
    index: '04',
    title: '记忆',
    subtitle: '归档、搜索、整理',
    section: 'memory',
  },
  {
    index: '05',
    title: '工具',
    subtitle: '开关、提示、可用性',
    section: 'tools',
  },
  {
    index: '06',
    title: '图灵测试',
    subtitle: '自动评测、报告、回放',
    section: 'turing',
  },
]
