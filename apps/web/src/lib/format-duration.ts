export function formatDurationMs(ms: number): string {
  const safeMs = Math.max(0, Math.round(ms))
  if (safeMs < 1000) {
    return `${safeMs}ms`
  }

  return `${(safeMs / 1000).toFixed(1)}s`
}

export function formatDurationLabel(
  startedAt: number | null | undefined,
  finishedAt: number | null | undefined,
): string | null {
  if (typeof startedAt !== 'number' || Number.isNaN(startedAt)) {
    return null
  }

  if (typeof finishedAt !== 'number' || Number.isNaN(finishedAt)) {
    return '运行中…'
  }

  return formatDurationMs(finishedAt - startedAt)
}
