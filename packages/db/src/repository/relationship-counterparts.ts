import { desc, eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { getDb, getRawSqlite } from '../client'
import { relationshipCounterparts } from '../schema'

export interface RelationshipCounterpartRecord {
  id: string
  agentId: string
  name: string
  avatarUrl: string | null
  role: string | null
  description: string | null
  note: string | null
  createdAt: Date
  updatedAt: Date
}

function mapCounterpart(row: typeof relationshipCounterparts.$inferSelect): RelationshipCounterpartRecord {
  return {
    id: row.id,
    agentId: row.agentId,
    name: row.name,
    avatarUrl: row.avatarUrl ?? null,
    role: row.role ?? null,
    description: row.description ?? null,
    note: row.note ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function normalizeName(value: string) {
  return value.trim()
}

function normalizeOptionalText(value: string | null | undefined) {
  if (value === undefined) {
    return undefined
  }
  if (value === null) {
    return null
  }
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function ensureRelationshipCounterpartColumns() {
  getDb()
  const sqlite = getRawSqlite()
  const columns = sqlite.pragma("table_info('relationship_counterparts')") as Array<{ name: string }>
  const names = new Set(columns.map((column) => column.name))
  for (const [name, sql] of [
    ['avatar_url', 'ALTER TABLE relationship_counterparts ADD COLUMN avatar_url TEXT;'],
    ['role', 'ALTER TABLE relationship_counterparts ADD COLUMN role TEXT;'],
    ['description', 'ALTER TABLE relationship_counterparts ADD COLUMN description TEXT;'],
    ['note', 'ALTER TABLE relationship_counterparts ADD COLUMN note TEXT;'],
  ] as const) {
    if (!names.has(name)) {
      sqlite.exec(sql)
    }
  }
}

export function createRelationshipCounterpart(data: {
  agentId: string
  name: string
  avatarUrl?: string | null
  role?: string | null
  description?: string | null
  note?: string | null
}) {
  ensureRelationshipCounterpartColumns()
  const db = getDb()
  const name = normalizeName(data.name)
  const now = new Date()
  const id = randomUUID()
  db.insert(relationshipCounterparts).values({
    id,
    agentId: data.agentId,
    name,
    avatarUrl: normalizeOptionalText(data.avatarUrl),
    role: normalizeOptionalText(data.role),
    description: normalizeOptionalText(data.description),
    note: normalizeOptionalText(data.note),
    createdAt: now,
    updatedAt: now,
  }).run()
  return getRelationshipCounterpart(id)!
}

export function getRelationshipCounterpart(id: string) {
  ensureRelationshipCounterpartColumns()
  const db = getDb()
  const row = db.select()
    .from(relationshipCounterparts)
    .where(eq(relationshipCounterparts.id, id))
    .get()
  return row ? mapCounterpart(row) : undefined
}

export function listRelationshipCounterpartsByAgent(agentId: string) {
  ensureRelationshipCounterpartColumns()
  const db = getDb()
  return db.select()
    .from(relationshipCounterparts)
    .where(eq(relationshipCounterparts.agentId, agentId))
    .orderBy(desc(relationshipCounterparts.updatedAt))
    .all()
    .map(mapCounterpart)
}

export function updateRelationshipCounterpart(id: string, data: {
  name?: string
  avatarUrl?: string | null
  role?: string | null
  description?: string | null
  note?: string | null
}) {
  const existing = getRelationshipCounterpart(id)
  if (!existing) {
    return undefined
  }

  const db = getDb()
  const avatarUrl = normalizeOptionalText(data.avatarUrl)
  const role = normalizeOptionalText(data.role)
  const description = normalizeOptionalText(data.description)
  const note = normalizeOptionalText(data.note)
  db.update(relationshipCounterparts)
    .set({
      ...(data.name !== undefined ? { name: normalizeName(data.name) } : {}),
      ...(avatarUrl !== undefined ? { avatarUrl } : {}),
      ...(role !== undefined ? { role } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(note !== undefined ? { note } : {}),
      updatedAt: new Date(),
    })
    .where(eq(relationshipCounterparts.id, id))
    .run()
  return getRelationshipCounterpart(id)!
}

export function deleteRelationshipCounterpart(id: string) {
  const db = getDb()
  db.delete(relationshipCounterparts).where(eq(relationshipCounterparts.id, id)).run()
}

export function deleteRelationshipCounterpartsByAgent(agentId: string) {
  const db = getDb()
  db.delete(relationshipCounterparts).where(eq(relationshipCounterparts.agentId, agentId)).run()
}
