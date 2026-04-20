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
      consolidateLabel: 'Consolidating sqlite memory…',
      status: 'Consolidating…',
    }
  }

  return {
    refreshDisabled: pending,
    consolidateDisabled: pending || loading || memoryCount === 0,
    deleteDisabled: pending,
    consolidateLabel: 'Consolidate sqlite memory',
    status: loading || pending ? 'Loading…' : null,
  }
}
