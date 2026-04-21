import { and, asc, desc, eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { getDb } from '../client'
import { turingTestRuns } from '../schema'

export type TuringRunStatus =
  | 'queued'
  | 'preparing'
  | 'running'
  | 'interrupting'
  | 'interrupted'
  | 'completed'
  | 'failed'
  | 'cleaned'

export interface TuringReportRecord {
  verdict: 'pass' | 'fail'
  summary: string
  scores: {
    naturalness: number
    continuity: number
    recall: number
    emotion: number
    relationship: number
  }
  failures: string[]
  suggestions: string[]
  abort?: {
    stageId: string
    reason: string
    evidence: string
  } | null
}

export interface TuringTranscriptTurnRecord {
  stageId: string
  role: 'judge' | 'agent' | 'system'
  message: string
  createdAt: string
  meta?: Record<string, unknown>
}

export interface TuringRunRecord {
  id: string
  sourceAgentId: string
  tempAgentId: string | null
  tempSessionId: string | null
  status: TuringRunStatus
  currentStage: string | null
  abortReason: string | null
  judgeProvider: string | null
  judgeModel: string | null
  report: TuringReportRecord | null
  transcript: TuringTranscriptTurnRecord[] | null
  error: string | null
  createdAt: Date
  updatedAt: Date
  startedAt: Date | null
  finishedAt: Date | null
  cleanedAt: Date | null
}

function parseJson<T>(value: string | null): T | null {
  if (!value) {
    return null
  }
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

function mapRun(row: typeof turingTestRuns.$inferSelect): TuringRunRecord {
  return {
    id: row.id,
    sourceAgentId: row.sourceAgentId,
    tempAgentId: row.tempAgentId,
    tempSessionId: row.tempSessionId,
    status: row.status,
    currentStage: row.currentStage,
    abortReason: row.abortReason,
    judgeProvider: row.judgeProvider,
    judgeModel: row.judgeModel,
    report: parseJson<TuringReportRecord>(row.reportJson),
    transcript: parseJson<TuringTranscriptTurnRecord[]>(row.transcriptJson),
    error: row.error,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    cleanedAt: row.cleanedAt,
  }
}

export function createRun(input: {
  sourceAgentId: string
  judgeProvider?: string | null
  judgeModel?: string | null
}) {
  const db = getDb()
  const id = randomUUID()
  db.insert(turingTestRuns)
    .values({
      id,
      sourceAgentId: input.sourceAgentId,
      judgeProvider: input.judgeProvider ?? null,
      judgeModel: input.judgeModel ?? null,
      status: 'queued',
    })
    .run()
  return getRun(id)!
}

export function getRun(id: string) {
  const db = getDb()
  const row = db.select().from(turingTestRuns).where(eq(turingTestRuns.id, id)).get()
  return row ? mapRun(row) : undefined
}

export function listRunsBySourceAgent(sourceAgentId: string) {
  const db = getDb()
  return db.select()
    .from(turingTestRuns)
    .where(eq(turingTestRuns.sourceAgentId, sourceAgentId))
    .orderBy(desc(turingTestRuns.createdAt))
    .all()
    .map(mapRun)
}

export function getNextQueuedRun() {
  const db = getDb()
  const row = db.select()
    .from(turingTestRuns)
    .where(eq(turingTestRuns.status, 'queued'))
    .orderBy(asc(turingTestRuns.createdAt))
    .get()
  return row ? mapRun(row) : undefined
}

export function attachTempResources(runId: string, input: {
  tempAgentId: string
  tempSessionId: string
}) {
  const db = getDb()
  db.update(turingTestRuns)
    .set({
      tempAgentId: input.tempAgentId,
      tempSessionId: input.tempSessionId,
      updatedAt: new Date(),
    })
    .where(eq(turingTestRuns.id, runId))
    .run()
  return getRun(runId)!
}

export function detachTempResources(runId: string) {
  const db = getDb()
  db.update(turingTestRuns)
    .set({
      tempAgentId: null,
      tempSessionId: null,
      updatedAt: new Date(),
    })
    .where(eq(turingTestRuns.id, runId))
    .run()
  return getRun(runId)!
}

export function setRunStatus(runId: string, input: {
  status: TuringRunStatus
  currentStage?: string | null
  abortReason?: string | null
  error?: string | null
  startedAt?: Date | null
  finishedAt?: Date | null
  cleanedAt?: Date | null
}) {
  const db = getDb()
  db.update(turingTestRuns)
    .set({
      status: input.status,
      currentStage: input.currentStage,
      abortReason: input.abortReason,
      error: input.error,
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
      cleanedAt: input.cleanedAt,
      updatedAt: new Date(),
    })
    .where(eq(turingTestRuns.id, runId))
    .run()
  return getRun(runId)!
}

export function saveRunResult(runId: string, input: {
  report: TuringReportRecord
  transcript: TuringTranscriptTurnRecord[]
  status: 'completed' | 'interrupted'
  abortReason?: string | null
}) {
  const db = getDb()
  db.update(turingTestRuns)
    .set({
      reportJson: JSON.stringify(input.report),
      transcriptJson: JSON.stringify(input.transcript),
      status: input.status,
      abortReason: input.abortReason ?? null,
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(turingTestRuns.id, runId))
    .run()
  return getRun(runId)!
}

export function markRunCleaned(runId: string) {
  return setRunStatus(runId, {
    status: 'cleaned',
    cleanedAt: new Date(),
    currentStage: null,
  })
}

export function deleteRun(runId: string) {
  const db = getDb()
  db.delete(turingTestRuns).where(eq(turingTestRuns.id, runId)).run()
}

export function findRunningRunByTempAgent(tempAgentId: string) {
  const db = getDb()
  const row = db.select()
    .from(turingTestRuns)
    .where(and(
      eq(turingTestRuns.tempAgentId, tempAgentId),
      eq(turingTestRuns.status, 'running'),
    ))
    .get()
  return row ? mapRun(row) : undefined
}
