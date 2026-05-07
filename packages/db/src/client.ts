import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { existsSync, mkdirSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'
import * as schema from './schema'

let db: ReturnType<typeof drizzle> | null = null
let rawSqlite: Database.Database | null = null

export function resolveDefaultAppDbPath(rootDir = process.cwd()) {
  return process.env.MAS_APP_DB_PATH?.trim()
    || join(rootDir, 'storage', 'app', 'data.db')
}

export function migrateLegacyAppDb(input: {
  legacyPath: string
  targetPath: string
}) {
  if (!existsSync(input.legacyPath) || existsSync(input.targetPath)) {
    return false
  }

  mkdirSync(dirname(input.targetPath), { recursive: true })
  renameSync(input.legacyPath, input.targetPath)
  for (const suffix of ['-wal', '-shm']) {
    const legacySidecar = `${input.legacyPath}${suffix}`
    if (existsSync(legacySidecar)) {
      renameSync(legacySidecar, `${input.targetPath}${suffix}`)
    }
  }
  return true
}

export function getDb(dbPath?: string) {
  if (!db) {
    const resolvedPath = dbPath ?? resolveDefaultAppDbPath()
    mkdirSync(dirname(resolvedPath), { recursive: true })
    rawSqlite = new Database(resolvedPath)
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

export function resetDb() {
  if (rawSqlite) {
    rawSqlite.close()
  }
  db = null
  rawSqlite = null
}
