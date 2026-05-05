import { getDb, getRawSqlite } from './client'
import { getMemoryDb } from './memory-client'

let initializedKey: string | null = null

export function bootstrapAppDatabases(input: {
  dbPath: string
  memoryDbPath: string
}) {
  const key = `${input.dbPath}::${input.memoryDbPath}`
  if (initializedKey === key) {
    return
  }

  process.env.MAS_MEMORY_DB_PATH = input.memoryDbPath
  getDb(input.dbPath)
  getMemoryDb(input.memoryDbPath)
  const sqlite = getRawSqlite()
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      personality TEXT,
      skills TEXT,
      modules TEXT,
      status TEXT NOT NULL DEFAULT 'idle',
      model TEXT NOT NULL,
      config TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    );
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id),
      title TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    );
    CREATE TABLE IF NOT EXISTS relationship_counterparts (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id),
      name TEXT NOT NULL,
      avatar_url TEXT,
      role TEXT,
      description TEXT,
      note TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_relationship_counterparts_agent_updated_at
      ON relationship_counterparts(agent_id, updated_at);
    CREATE TABLE IF NOT EXISTS session_relationship_bindings (
      session_id TEXT PRIMARY KEY REFERENCES sessions(id),
      counterpart_id TEXT NOT NULL REFERENCES relationship_counterparts(id),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_session_relationship_bindings_counterpart_id
      ON session_relationship_bindings(counterpart_id);
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      token_count INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    );
    CREATE TABLE IF NOT EXISTS session_context_state (
      session_id TEXT PRIMARY KEY REFERENCES sessions(id),
      active_start_message_id TEXT,
      pending_flush_until_message_id TEXT,
      last_user_message_at INTEGER,
      last_context_flush_at INTEGER,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    );
    CREATE TABLE IF NOT EXISTS tool_executions (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL REFERENCES messages(id),
      tool_name TEXT NOT NULL,
      input TEXT NOT NULL,
      output TEXT NOT NULL,
      is_error INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    );
    CREATE TABLE IF NOT EXISTS llm_calls (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      user_message_id TEXT NOT NULL REFERENCES messages(id),
      turn_index INTEGER NOT NULL,
      kind TEXT NOT NULL DEFAULT 'turn',
      model TEXT NOT NULL,
      system_prompt TEXT NOT NULL,
      tools_json TEXT NOT NULL,
      messages_json TEXT NOT NULL,
      metadata_json TEXT,
      response_json TEXT,
      stop_reason TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      error TEXT
    );
    CREATE TABLE IF NOT EXISTS emotion_states (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id),
      session_id TEXT NOT NULL REFERENCES sessions(id),
      state TEXT NOT NULL,
      delta TEXT,
      trigger TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    );
    CREATE TABLE IF NOT EXISTS relationships (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id),
      counterpart_type TEXT NOT NULL,
      counterpart_id TEXT NOT NULL,
      dimensions TEXT NOT NULL,
      history TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_llm_calls_session ON llm_calls(session_id, started_at);
    CREATE INDEX IF NOT EXISTS idx_llm_calls_user_msg ON llm_calls(user_message_id, turn_index);
    CREATE INDEX IF NOT EXISTS idx_emotion_states_session ON emotion_states(session_id, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_relationships_agent_counterpart
      ON relationships(agent_id, counterpart_type, counterpart_id);
    CREATE INDEX IF NOT EXISTS idx_relationships_agent_updated_at
      ON relationships(agent_id, updated_at);
    CREATE TABLE IF NOT EXISTS daemon_state (
      id TEXT PRIMARY KEY,
      pid INTEGER NOT NULL,
      status TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      last_heartbeat_at INTEGER NOT NULL,
      stopped_at INTEGER,
      last_error TEXT,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    );
    CREATE TABLE IF NOT EXISTS daemon_events (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      scope TEXT NOT NULL,
      message TEXT NOT NULL,
      payload_json TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_daemon_events_created_at
      ON daemon_events(created_at);
    CREATE INDEX IF NOT EXISTS idx_daemon_events_scope_created_at
      ON daemon_events(scope, created_at);
    CREATE TABLE IF NOT EXISTS agent_memory_sleep_state (
      agent_id TEXT PRIMARY KEY REFERENCES agents(id),
      last_sleep_at INTEGER,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    );
    CREATE TABLE IF NOT EXISTS turing_test_runs (
      id TEXT PRIMARY KEY,
      source_agent_id TEXT NOT NULL REFERENCES agents(id),
      temp_agent_id TEXT REFERENCES agents(id),
      temp_session_id TEXT REFERENCES sessions(id),
      status TEXT NOT NULL DEFAULT 'queued',
      current_stage TEXT,
      abort_reason TEXT,
      judge_provider TEXT,
      judge_model TEXT,
      report_json TEXT,
      transcript_json TEXT,
      error TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      started_at INTEGER,
      finished_at INTEGER,
      cleaned_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_turing_test_runs_status_created_at
      ON turing_test_runs(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_turing_test_runs_source_agent_id
      ON turing_test_runs(source_agent_id, created_at);
    CREATE TABLE IF NOT EXISTS turing_test_events (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES turing_test_runs(id),
      kind TEXT NOT NULL,
      message TEXT NOT NULL,
      payload_json TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_turing_test_events_run_created_at
      ON turing_test_events(run_id, created_at);
  `)
  sqlite.exec(`
    DROP INDEX IF EXISTS idx_memories_agent_created_at;
    DROP INDEX IF EXISTS idx_memories_agent_id;
    DROP TABLE IF EXISTS memories;
  `)
  const agentColumns = sqlite.pragma("table_info('agents')") as Array<{ name: string }>
  if (!agentColumns.some((column) => column.name === 'modules')) {
    sqlite.exec('ALTER TABLE agents ADD COLUMN modules TEXT;')
  }
  const llmCallColumns = sqlite.pragma("table_info('llm_calls')") as Array<{ name: string }>
  if (!llmCallColumns.some((column) => column.name === 'kind')) {
    sqlite.exec("ALTER TABLE llm_calls ADD COLUMN kind TEXT NOT NULL DEFAULT 'turn';")
  }
  if (!llmCallColumns.some((column) => column.name === 'metadata_json')) {
    sqlite.exec('ALTER TABLE llm_calls ADD COLUMN metadata_json TEXT;')
  }
  const relationshipCounterpartColumns = sqlite.pragma("table_info('relationship_counterparts')") as Array<{ name: string }>
  const relationshipCounterpartColumnNames = new Set(relationshipCounterpartColumns.map((column) => column.name))
  for (const [name, sql] of [
    ['avatar_url', 'ALTER TABLE relationship_counterparts ADD COLUMN avatar_url TEXT;'],
    ['role', 'ALTER TABLE relationship_counterparts ADD COLUMN role TEXT;'],
    ['description', 'ALTER TABLE relationship_counterparts ADD COLUMN description TEXT;'],
    ['note', 'ALTER TABLE relationship_counterparts ADD COLUMN note TEXT;'],
  ] as const) {
    if (!relationshipCounterpartColumnNames.has(name)) {
      sqlite.exec(sql)
    }
  }
  const relationshipColumns = sqlite.pragma("table_info('relationships')") as Array<{ name: string }>
  if (relationshipColumns.some((column) => column.name === 'counterpart_type')) {
    sqlite.exec(`
      UPDATE relationships
      SET counterpart_type = CASE
        WHEN counterpart_type IS NULL OR counterpart_type = '' THEN 'user'
        ELSE counterpart_type
      END
    `)
  }

  initializedKey = key
}
