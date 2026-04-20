export interface SqliteMemoryToolbarState {
  refreshDisabled: boolean
  consolidateDisabled: boolean
  deleteDisabled: boolean
  consolidateLabel: string
  status: string | null
}

interface SqliteMemoryToolbarStateInput {
  loading: boolean
  pending: boolean
  isConsolidating: boolean
  memoryCount: number
}

export function getSqliteMemoryToolbarState({
  loading,
  pending,
  isConsolidating,
  memoryCount,
}: SqliteMemoryToolbarStateInput): SqliteMemoryToolbarState {
  if (isConsolidating) {
    return {
      refreshDisabled: true,
      consolidateDisabled: true,
      deleteDisabled: true,
      consolidateLabel: '正在整理 sqlite 记忆…',
      status: '整理中…',
    }
  }

  return {
    refreshDisabled: pending,
    consolidateDisabled: pending || loading || memoryCount === 0,
    deleteDisabled: pending,
    consolidateLabel: '整理 sqlite 记忆',
    status: loading || pending ? '加载中…' : null,
  }
}
