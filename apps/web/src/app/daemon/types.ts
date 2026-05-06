import type { DaemonSectionId } from './daemon-sections'

export interface DaemonStateView {
  id: string
  pid: number
  status: 'starting' | 'running' | 'stopping' | 'stopped'
  startedAt: string
  lastHeartbeatAt: string
  stoppedAt: string | null
  lastError: string | null
  updatedAt: string
}

export interface DaemonOverviewData {
  daemon: DaemonStateView | null
  tickIntervalMs: number
  recentEventCounts: {
    total: number
    daemon: number
    memoryFlush: number
    memorySleep: number
  }
}

export interface DaemonEventView {
  id: string
  kind: string
  scope: 'daemon' | 'memory_flush' | 'memory_sleep'
  message: string
  payload: Record<string, unknown> | null
  createdAt: string
}

export interface DaemonContextFlushItem {
  sessionId: string
  sessionTitle: string | null
  agentId: string
  agentName: string
  activeStartMessageId: string | null
  pendingFlushUntilMessageId: string | null
  activeMessageCount: number
  totalSessionMessages: number
  lastUserMessageAt: string | null
  lastContextFlushAt: string | null
  canFlush: boolean
  flushReason: 'overflow' | 'idle' | null
}

export interface DaemonSleepItem {
  agentId: string
  agentName: string
  shortTermCount: number
  sleepEnabled: boolean
  sleepTimeLocal: string
  sleepIntervalDays: number
  lastSleepAt: string | null
  lastSleepEventAt: string | null
  canSleep: boolean
}

export interface DaemonSectionRef {
  id: DaemonSectionId
  element: HTMLElement | null
}
