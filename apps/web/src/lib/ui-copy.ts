export const COMMON_UI_COPY = {
  backToPersonas: '返回虚拟人列表',
  openChat: '打开聊天',
  unifiedEntry: '统一入口',
  agent: '虚拟人',
  scheme: '方案',
  saveChanges: '保存更改',
  saving: '保存中…',
  expand: '展开',
  collapse: '收起',
  unconfigured: '未配置',
} as const

export const OBSERVER_UI_COPY = {
  title: '观测器',
  sessions: '会话',
  untitled: '未命名',
  clearAllData: '清空全部观测记录',
  clearAllDataConfirm: '删除全部 Observer 数据？此操作无法撤销。',
  selectCall: '选择一个调用查看详情。',
  loading: '加载中…',
  input: '输入',
  output: '输出',
  system: '系统提示',
  tools: '工具',
  history: '历史消息',
  metadata: '元数据',
  compaction: '压缩',
  emotion: '情绪',
  memory: '记忆',
  response: '响应',
  messages: '消息',
  toolsSchema: '工具 schema',
  finalSystemPrompt: '最终 system prompt',
  model: '模型',
  duration: '耗时',
  fragments: '片段',
  stop: '停止原因',
  inputTokens: '输入',
  outputTokens: '输出',
  running: '运行中',
  finished: '已结束',
  phase: '阶段',
  keywords: '关键词',
  timeRange: '时间范围',
  hits: '命中',
  written: '写入结果',
  report: '报告',
  before: '变更前',
  after: '变更后',
  delta: '变化量',
  trigger: '触发原因',
  analysis: '分析',
  latestEmotionState: '最新 emotion_state 记录',
  waitingMessageSnapshot: '等待该调用的消息快照…',
  pending: '等待中',
  toolUse: '工具调用',
  toolResult: '工具结果',
  result: '结果',
  summaryCompaction: '本轮压缩',
  mainTurn: '主对话',
  retrieve: '检索',
  summarize: '总结',
  consolidate: '整理',
} as const

export function translateRole(role: string) {
  if (role === 'user') return '用户'
  if (role === 'assistant') return '助手'
  if (role === 'system') return '系统'
  return role
}

export function translateObserverTab(tab: string) {
  if (tab === 'system') return OBSERVER_UI_COPY.system
  if (tab === 'tools') return OBSERVER_UI_COPY.tools
  if (tab === 'history') return OBSERVER_UI_COPY.history
  if (tab === 'metadata') return OBSERVER_UI_COPY.metadata
  if (tab === 'compaction') return OBSERVER_UI_COPY.compaction
  if (tab === 'emotion') return OBSERVER_UI_COPY.emotion
  if (tab === 'memory') return OBSERVER_UI_COPY.memory
  if (tab === 'response') return OBSERVER_UI_COPY.response
  return tab
}

export function translateCallKind(kind: string) {
  if (kind === 'compaction') return '压缩'
  if (kind === 'memory') return '记忆'
  if (kind === 'emotion') return '情绪'
  if (kind === 'relationship') return '关系'
  if (kind === 'turn') return OBSERVER_UI_COPY.mainTurn
  return kind
}

export function translateMemoryPhase(phase: string) {
  if (phase === 'retrieve') return OBSERVER_UI_COPY.retrieve
  if (phase === 'summarize') return OBSERVER_UI_COPY.summarize
  if (phase === 'consolidate') return OBSERVER_UI_COPY.consolidate
  return phase
}
