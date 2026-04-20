export interface LoggerLike {
  info?: (message: string) => void
  error?: (message: string) => void
}

export interface TickContext {
  signal: AbortSignal
}

export interface DaemonRunnerOptions {
  dbPath: string
  lockPath: string
  pid?: number
  tickIntervalMs?: number
  tick?: (context: TickContext) => Promise<void> | void
  logger?: LoggerLike
}
