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
  const hasMemoriesTable = sqlite.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table' AND name = 'memories'
  `).get() as { name?: string } | undefined

  if (hasMemoriesTable) {
    const columns = sqlite.prepare(`PRAGMA table_info(memories)`).all() as Array<{ name: string }>
    const hasLayer = columns.some((column) => column.name === 'layer')
    if (!hasLayer) {
      sqlite.exec(`
        DROP TABLE IF EXISTS memories;
        DROP INDEX IF EXISTS idx_memories_agent_created_at;
        DROP INDEX IF EXISTS idx_memories_agent_id;
      `)
    }
  }

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      layer TEXT NOT NULL DEFAULT 'short_term',
      source_text TEXT NOT NULL,
      display_summary TEXT NOT NULL,
      retrieval_text TEXT NOT NULL,
      retrieval_embedding TEXT NOT NULL,
      retrieval_model TEXT NOT NULL,
      tags TEXT NOT NULL,
      importance REAL NOT NULL,
      observed_start_at INTEGER,
      observed_end_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_memories_agent_created_at ON memories(agent_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_memories_agent_id ON memories(agent_id);
  `)

  const columns = sqlite.prepare(`PRAGMA table_info(memories)`).all() as Array<{ name: string }>
  if (!columns.some((column) => column.name === 'observed_start_at')) {
    sqlite.exec('ALTER TABLE memories ADD COLUMN observed_start_at INTEGER;')
  }
  if (!columns.some((column) => column.name === 'observed_end_at')) {
    sqlite.exec('ALTER TABLE memories ADD COLUMN observed_end_at INTEGER;')
  }

  sqlite.exec(`
    DROP INDEX IF EXISTS idx_memory_entity_activations_expiry;
    DROP TABLE IF EXISTS memory_entity_activations;
  `)

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS memory_entities (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      type TEXT NOT NULL,
      canonical_name TEXT NOT NULL,
      description TEXT,
      confidence REAL NOT NULL,
      embedding_text TEXT NOT NULL DEFAULT '',
      embedding TEXT NOT NULL DEFAULT '[]',
      embedding_model TEXT NOT NULL DEFAULT '',
      embedding_updated_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      last_seen_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_memory_entities_agent_type_name
      ON memory_entities(agent_id, type, canonical_name);
    CREATE INDEX IF NOT EXISTS idx_memory_entities_agent_last_seen
      ON memory_entities(agent_id, last_seen_at);

    CREATE TABLE IF NOT EXISTS memory_entity_aliases (
      id TEXT PRIMARY KEY,
      entity_id TEXT NOT NULL,
      alias TEXT NOT NULL,
      confidence REAL NOT NULL,
      source_memory_id TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      last_seen_at INTEGER,
      UNIQUE(entity_id, alias)
    );
    CREATE INDEX IF NOT EXISTS idx_memory_entity_aliases_alias
      ON memory_entity_aliases(alias);

    CREATE TABLE IF NOT EXISTS memory_entity_edges (
      agent_id TEXT NOT NULL,
      source_entity_id TEXT NOT NULL,
      target_entity_id TEXT NOT NULL,
      weight REAL NOT NULL,
      co_occurrence_count INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      PRIMARY KEY(agent_id, source_entity_id, target_entity_id)
    );

    CREATE TABLE IF NOT EXISTS episodic_memories (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      summary TEXT NOT NULL,
      source_text TEXT NOT NULL,
      detail TEXT,
      retrieval_embedding TEXT NOT NULL DEFAULT '[]',
      retrieval_model TEXT NOT NULL DEFAULT '',
      importance REAL NOT NULL,
      observed_start_at INTEGER,
      observed_end_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_episodic_memories_agent_created
      ON episodic_memories(agent_id, created_at);

    CREATE TABLE IF NOT EXISTS episodic_memory_entities (
      memory_id TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      weight REAL NOT NULL,
      PRIMARY KEY(memory_id, entity_id)
    );
    CREATE INDEX IF NOT EXISTS idx_episodic_memory_entities_entity
      ON episodic_memory_entities(entity_id);
  `)

  const entityColumns = sqlite.pragma("table_info('memory_entities')") as Array<{ name: string }>
  const entityColumnNames = new Set(entityColumns.map((column) => column.name))
  if (!entityColumnNames.has('embedding_text')) {
    sqlite.exec("ALTER TABLE memory_entities ADD COLUMN embedding_text TEXT NOT NULL DEFAULT '';")
  }
  if (!entityColumnNames.has('embedding')) {
    sqlite.exec("ALTER TABLE memory_entities ADD COLUMN embedding TEXT NOT NULL DEFAULT '[]';")
  }
  if (!entityColumnNames.has('embedding_model')) {
    sqlite.exec("ALTER TABLE memory_entities ADD COLUMN embedding_model TEXT NOT NULL DEFAULT '';")
  }
  if (!entityColumnNames.has('embedding_updated_at')) {
    sqlite.exec('ALTER TABLE memory_entities ADD COLUMN embedding_updated_at INTEGER;')
  }

  const episodicColumns = sqlite.pragma("table_info('episodic_memories')") as Array<{ name: string }>
  const episodicColumnNames = new Set(episodicColumns.map((column) => column.name))
  const legacyDetailColumn = ['source', 'quote'].join('_')
  if (!episodicColumnNames.has('detail') && episodicColumnNames.has(legacyDetailColumn)) {
    sqlite.exec(`ALTER TABLE episodic_memories RENAME COLUMN ${legacyDetailColumn} TO detail;`)
    episodicColumnNames.delete(legacyDetailColumn)
    episodicColumnNames.add('detail')
  }
  if (!episodicColumnNames.has('detail')) {
    sqlite.exec('ALTER TABLE episodic_memories ADD COLUMN detail TEXT;')
  }
  if (!episodicColumnNames.has('retrieval_embedding')) {
    sqlite.exec("ALTER TABLE episodic_memories ADD COLUMN retrieval_embedding TEXT NOT NULL DEFAULT '[]';")
  }
  if (!episodicColumnNames.has('retrieval_model')) {
    sqlite.exec("ALTER TABLE episodic_memories ADD COLUMN retrieval_model TEXT NOT NULL DEFAULT '';")
    episodicColumnNames.add('retrieval_model')
  }
  if (episodicColumnNames.has('retrieval_text')) {
    sqlite.exec(`
      CREATE TABLE episodic_memories_without_retrieval_text (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        summary TEXT NOT NULL,
        source_text TEXT NOT NULL,
        detail TEXT,
        retrieval_embedding TEXT NOT NULL DEFAULT '[]',
        retrieval_model TEXT NOT NULL DEFAULT '',
        importance REAL NOT NULL,
        observed_start_at INTEGER,
        observed_end_at INTEGER,
        created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
      );
      INSERT INTO episodic_memories_without_retrieval_text (
        id,
        agent_id,
        session_id,
        summary,
        source_text,
        detail,
        retrieval_embedding,
        retrieval_model,
        importance,
        observed_start_at,
        observed_end_at,
        created_at
      )
      SELECT
        id,
        agent_id,
        session_id,
        summary,
        source_text,
        detail,
        retrieval_embedding,
        retrieval_model,
        importance,
        observed_start_at,
        observed_end_at,
        created_at
      FROM episodic_memories;
      DROP TABLE episodic_memories;
      ALTER TABLE episodic_memories_without_retrieval_text RENAME TO episodic_memories;
      CREATE INDEX IF NOT EXISTS idx_episodic_memories_agent_created
        ON episodic_memories(agent_id, created_at);
    `)
  }
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
