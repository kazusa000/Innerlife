import { eq } from 'drizzle-orm'
import { getDb, getRawSqlite } from '../client'
import { daemonState } from '../schema'

export type DaemonStatus = 'starting' | 'running' | 'stopping' | 'stopped'

export interface DaemonStateRecord {
  id: string
  pid: number
  status: DaemonStatus
  startedAt: Date
  lastHeartbeatAt: Date
  stoppedAt: Date | null
  lastError: string | null
  updatedAt: Date
}

const DAEMON_STATE_ID = 'local'

function ensureDaemonStateTable() {
  getRawSqlite().exec(`
    CREATE TABLE IF NOT EXISTS daemon_state (
      id TEXT PRIMARY KEY NOT NULL,
      pid INTEGER NOT NULL,
      status TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      last_heartbeat_at INTEGER NOT NULL,
      stopped_at INTEGER,
      last_error TEXT,
      updated_at INTEGER NOT NULL
    );
  `)
}

function mapDaemonState(row: typeof daemonState.$inferSelect): DaemonStateRecord {
  return {
    ...row,
    status: row.status as DaemonStatus,
  }
}

function upsertDaemonState(input: typeof daemonState.$inferInsert) {
  ensureDaemonStateTable()
  const db = getDb()

  db.insert(daemonState)
    .values(input)
    .onConflictDoUpdate({
      target: daemonState.id,
      set: {
        pid: input.pid,
        status: input.status,
        startedAt: input.startedAt,
        lastHeartbeatAt: input.lastHeartbeatAt,
        stoppedAt: input.stoppedAt,
        lastError: input.lastError,
        updatedAt: input.updatedAt,
      },
    })
    .run()
}

export function markDaemonRunning(data: {
  pid: number
  startedAt?: Date
  lastHeartbeatAt?: Date
}) {
  const timestamp = data.startedAt ?? new Date()
  const heartbeatAt = data.lastHeartbeatAt ?? timestamp

  upsertDaemonState({
    id: DAEMON_STATE_ID,
    pid: data.pid,
    status: 'running',
    startedAt: timestamp,
    lastHeartbeatAt: heartbeatAt,
    stoppedAt: null,
    lastError: null,
    updatedAt: heartbeatAt,
  })

  return getDaemonState()!
}

export function markDaemonHeartbeat(data: {
  pid: number
  heartbeatAt?: Date
}) {
  const current = getDaemonState()
  const heartbeatAt = data.heartbeatAt ?? new Date()
  const startedAt = current?.startedAt ?? heartbeatAt

  upsertDaemonState({
    id: DAEMON_STATE_ID,
    pid: data.pid,
    status: 'running',
    startedAt,
    lastHeartbeatAt: heartbeatAt,
    stoppedAt: null,
    lastError: current?.lastError ?? null,
    updatedAt: heartbeatAt,
  })

  return getDaemonState()!
}

export function markDaemonStopping(data: {
  pid: number
  stoppedAt?: Date
}) {
  const current = getDaemonState()
  const stoppedAt = data.stoppedAt ?? new Date()

  upsertDaemonState({
    id: DAEMON_STATE_ID,
    pid: data.pid,
    status: 'stopping',
    startedAt: current?.startedAt ?? stoppedAt,
    lastHeartbeatAt: current?.lastHeartbeatAt ?? stoppedAt,
    stoppedAt,
    lastError: current?.lastError ?? null,
    updatedAt: stoppedAt,
  })

  return getDaemonState()!
}

export function markDaemonStopped(data: {
  pid: number
  stoppedAt?: Date
}) {
  const current = getDaemonState()
  const stoppedAt = data.stoppedAt ?? new Date()

  upsertDaemonState({
    id: DAEMON_STATE_ID,
    pid: data.pid,
    status: 'stopped',
    startedAt: current?.startedAt ?? stoppedAt,
    lastHeartbeatAt: current?.lastHeartbeatAt ?? stoppedAt,
    stoppedAt,
    lastError: current?.lastError ?? null,
    updatedAt: stoppedAt,
  })

  return getDaemonState()!
}

export function recordDaemonError(message: string) {
  const current = getDaemonState()
  if (!current) {
    return undefined
  }

  upsertDaemonState({
    id: current.id,
    pid: current.pid,
    status: current.status,
    startedAt: current.startedAt,
    lastHeartbeatAt: current.lastHeartbeatAt,
    stoppedAt: current.stoppedAt,
    lastError: message,
    updatedAt: new Date(),
  })

  return getDaemonState()!
}

export function clearDaemonError() {
  const current = getDaemonState()
  if (!current) {
    return undefined
  }

  upsertDaemonState({
    id: current.id,
    pid: current.pid,
    status: current.status,
    startedAt: current.startedAt,
    lastHeartbeatAt: current.lastHeartbeatAt,
    stoppedAt: current.stoppedAt,
    lastError: null,
    updatedAt: new Date(),
  })

  return getDaemonState()!
}

export function getDaemonState() {
  ensureDaemonStateTable()
  const db = getDb()
  const row = db.select()
    .from(daemonState)
    .where(eq(daemonState.id, DAEMON_STATE_ID))
    .get()

  return row ? mapDaemonState(row) : undefined
}
