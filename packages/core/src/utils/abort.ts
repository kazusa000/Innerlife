export function createAbortError(reason?: unknown): Error {
  const message =
    typeof reason === 'string'
      ? reason
      : reason instanceof Error && reason.message
        ? reason.message
        : 'The operation was aborted'

  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === 'AbortError') ||
    (typeof DOMException !== 'undefined' &&
      error instanceof DOMException &&
      error.name === 'AbortError')
  )
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw createAbortError(signal.reason)
  }
}
