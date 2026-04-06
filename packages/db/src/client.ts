import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema.js'

let db: ReturnType<typeof drizzle> | null = null

export function getDb(dbPath?: string) {
  if (!db) {
    const sqlite = new Database(dbPath ?? 'data.db')
    sqlite.pragma('journal_mode = WAL')
    sqlite.pragma('foreign_keys = ON')
    db = drizzle(sqlite, { schema })
  }
  return db
}
