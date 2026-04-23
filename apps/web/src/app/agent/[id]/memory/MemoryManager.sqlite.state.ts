export interface SqliteMemoryToolbarState {
  refreshDisabled: boolean
  deleteDisabled: boolean
  status: string | null
}

interface SqliteMemoryToolbarStateInput {
  loading: boolean
  pending: boolean
  memoryCount: number
}

export function getSqliteMemoryToolbarState({
  loading,
  pending,
}: SqliteMemoryToolbarStateInput): SqliteMemoryToolbarState {
  return {
    refreshDisabled: pending,
    deleteDisabled: pending,
    status: loading || pending ? '加载中…' : null,
  }
}
