import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'

let db: ReturnType<typeof drizzle> | null = null
let rawSqlite: Database.Database | null = null

export function getDb(dbPath?: string) {
  if (!db) {
    rawSqlite = new Database(dbPath ?? 'data.db')
    rawSqlite.pragma('journal_mode = WAL')
    rawSqlite.pragma('foreign_keys = ON')
    db = drizzle(rawSqlite, { schema })
  }
  return db
}

export function getRawSqlite(): Database.Database {
  if (!rawSqlite) {
    getDb()
  }
  return rawSqlite!
}
