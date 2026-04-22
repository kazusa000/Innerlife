import { eq } from 'drizzle-orm'
import { getDb } from '../client'
import { agentMemorySleepState } from '../schema'

export interface AgentMemorySleepStateRecord {
  agentId: string
  lastSleepAt: Date | null
  updatedAt: Date
}

function mapState(row: typeof agentMemorySleepState.$inferSelect): AgentMemorySleepStateRecord {
  return {
    agentId: row.agentId,
    lastSleepAt: row.lastSleepAt,
    updatedAt: row.updatedAt,
  }
}

export function getAgentMemorySleepState(agentId: string) {
  const db = getDb()
  const row = db
    .select()
    .from(agentMemorySleepState)
    .where(eq(agentMemorySleepState.agentId, agentId))
    .get()

  return row ? mapState(row) : undefined
}

export function upsertAgentMemorySleepState(input: {
  agentId: string
  lastSleepAt?: Date | null
}) {
  const db = getDb()
  const existing = getAgentMemorySleepState(input.agentId)
  const next = {
    agentId: input.agentId,
    lastSleepAt:
      input.lastSleepAt !== undefined
        ? input.lastSleepAt
        : existing?.lastSleepAt ?? null,
    updatedAt: new Date(),
  }

  db.insert(agentMemorySleepState)
    .values(next)
    .onConflictDoUpdate({
      target: agentMemorySleepState.agentId,
      set: {
        lastSleepAt: next.lastSleepAt,
        updatedAt: next.updatedAt,
      },
    })
    .run()

  return getAgentMemorySleepState(input.agentId)!
}

export function deleteAgentMemorySleepState(agentId: string) {
  const db = getDb()
  db.delete(agentMemorySleepState)
    .where(eq(agentMemorySleepState.agentId, agentId))
    .run()
}
