import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

let db: Database.Database | null = null
let activePath: string | null = null

function resolveDefaultMemoryDbPath() {
  return process.env.MAS_MEMORY_DB_PATH?.trim()
    || join(process.cwd(), 'storage', 'memory', 'memory.db')
}

function ensureMemoryDbSchema(sqlite: Database.Database) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      source_text TEXT NOT NULL,
      display_summary TEXT NOT NULL,
      retrieval_text TEXT NOT NULL,
      retrieval_embedding TEXT NOT NULL,
      retrieval_model TEXT NOT NULL,
      tags TEXT NOT NULL,
      importance REAL NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_memories_agent_created_at ON memories(agent_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_memories_agent_id ON memories(agent_id);
  `)
}

export function getMemoryDb(dbPath?: string): Database.Database {
  const nextPath = dbPath ?? resolveDefaultMemoryDbPath()

  if (db && activePath !== nextPath) {
    db.close()
    db = null
    activePath = null
  }

  if (!db) {
    mkdirSync(dirname(nextPath), { recursive: true })
    db = new Database(nextPath)
    db.pragma('journal_mode = WAL')
    ensureMemoryDbSchema(db)
    activePath = nextPath
  }

  return db
}

export function getMemoryRawSqlite(): Database.Database {
  return getMemoryDb()
}

export function resetMemoryDb() {
  if (db) {
    db.close()
  }
  db = null
  activePath = null
}
