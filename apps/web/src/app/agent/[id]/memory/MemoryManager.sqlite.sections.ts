export type MemoryManagerSectionId = 'context' | 'sleep' | 'prompt' | 'memory'

export interface MemoryManagerSection {
  id: MemoryManagerSectionId
  anchor: string
  label: string
  description: string
}

const MEMORY_MANAGER_SECTIONS: MemoryManagerSection[] = [
  { id: 'context', anchor: 'memory-section-context', label: 'Context', description: '缓存窗口' },
  { id: 'sleep', anchor: 'memory-section-sleep', label: '睡眠', description: '沉淀节奏' },
  { id: 'prompt', anchor: 'memory-section-prompt', label: 'Prompt Lab', description: '提示词' },
  { id: 'memory', anchor: 'memory-section-memory', label: '记忆', description: '检索与层级' },
]

export function getMemoryManagerSections() {
  return MEMORY_MANAGER_SECTIONS
}
