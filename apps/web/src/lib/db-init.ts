import path from 'node:path'
import { getDb, getRawSqlite, agentRepo } from '@mas/db'

const DB_PATH = path.resolve(process.cwd(), '..', '..', 'data.db')

let initialized = false

export function initDb() {
  if (initialized) return
  getDb(DB_PATH)
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
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id),
      title TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      token_count INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
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
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id),
      session_id TEXT NOT NULL REFERENCES sessions(id),
      content TEXT NOT NULL,
      summary TEXT NOT NULL,
      tags TEXT NOT NULL,
      importance REAL NOT NULL,
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
    CREATE INDEX IF NOT EXISTS idx_memories_agent_created_at ON memories(agent_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_memories_agent_id ON memories(agent_id);
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
  `)
  const columns = sqlite.pragma("table_info('agents')") as Array<{ name: string }>
  if (!columns.some((column) => column.name === 'modules')) {
    sqlite.exec('ALTER TABLE agents ADD COLUMN modules TEXT;')
  }
  const llmCallColumns = sqlite.pragma("table_info('llm_calls')") as Array<{ name: string }>
  if (!llmCallColumns.some((column) => column.name === 'kind')) {
    sqlite.exec("ALTER TABLE llm_calls ADD COLUMN kind TEXT NOT NULL DEFAULT 'turn';")
  }
  if (!llmCallColumns.some((column) => column.name === 'metadata_json')) {
    sqlite.exec('ALTER TABLE llm_calls ADD COLUMN metadata_json TEXT;')
  }
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS emotion_states (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id),
      session_id TEXT NOT NULL REFERENCES sessions(id),
      state TEXT NOT NULL,
      delta TEXT,
      trigger TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    );
  `)
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS relationships (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id),
      counterpart_type TEXT NOT NULL,
      counterpart_id TEXT NOT NULL,
      dimensions TEXT NOT NULL,
      history TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_relationships_agent_counterpart
      ON relationships(agent_id, counterpart_type, counterpart_id);
    CREATE INDEX IF NOT EXISTS idx_relationships_agent_updated_at
      ON relationships(agent_id, updated_at);
  `)
  initialized = true
}

export function getDefaultAgent() {
  initDb()
  let agent = agentRepo.listAgents()[0]
  if (!agent) {
    agent = agentRepo.createAgent({
      name: 'Default Agent',
      description: 'A helpful AI assistant that can execute bash commands.',
      model: 'claude-sonnet-4-6',
    })!
  }
  return agent
}
