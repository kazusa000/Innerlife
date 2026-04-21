import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const agents = sqliteTable('agents', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  personality: text('personality'),
  skills: text('skills'),
  modules: text('modules'),
  status: text('status', { enum: ['idle', 'running', 'error'] })
    .notNull()
    .default('idle'),
  model: text('model').notNull(),
  config: text('config'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
})

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  agentId: text('agent_id')
    .notNull()
    .references(() => agents.id),
  title: text('title'),
  status: text('status', { enum: ['active', 'archived'] })
    .notNull()
    .default('active'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
})

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  sessionId: text('session_id')
    .notNull()
    .references(() => sessions.id),
  role: text('role', { enum: ['user', 'assistant', 'system'] }).notNull(),
  content: text('content').notNull(),
  tokenCount: integer('token_count'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
})

export const toolExecutions = sqliteTable('tool_executions', {
  id: text('id').primaryKey(),
  messageId: text('message_id')
    .notNull()
    .references(() => messages.id),
  toolName: text('tool_name').notNull(),
  input: text('input').notNull(),
  output: text('output').notNull(),
  isError: integer('is_error', { mode: 'boolean' }).notNull().default(false),
  durationMs: integer('duration_ms'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
})

export const memories = sqliteTable('memories', {
  id: text('id').primaryKey(),
  agentId: text('agent_id')
    .notNull()
    .references(() => agents.id),
  sessionId: text('session_id')
    .notNull()
    .references(() => sessions.id),
  content: text('content').notNull(),
  summary: text('summary').notNull(),
  tags: text('tags').notNull(),
  importance: real('importance').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
}, (table) => ({
  agentCreatedAtIdx: index('idx_memories_agent_created_at').on(table.agentId, table.createdAt),
  agentIdIdx: index('idx_memories_agent_id').on(table.agentId),
}))

export const llmCalls = sqliteTable('llm_calls', {
  id: text('id').primaryKey(),
  sessionId: text('session_id')
    .notNull()
    .references(() => sessions.id),
  userMessageId: text('user_message_id')
    .notNull()
    .references(() => messages.id),
  turnIndex: integer('turn_index').notNull(),
  kind: text('kind', { enum: ['turn', 'compaction', 'memory', 'emotion', 'relationship'] })
    .notNull()
    .default('turn'),
  model: text('model').notNull(),
  systemPrompt: text('system_prompt').notNull(),
  toolsJson: text('tools_json').notNull(),
  messagesJson: text('messages_json').notNull(),
  metadataJson: text('metadata_json'),
  responseJson: text('response_json'),
  stopReason: text('stop_reason'),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull(),
  finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
  error: text('error'),
})

export const emotionStates = sqliteTable('emotion_states', {
  id: text('id').primaryKey(),
  agentId: text('agent_id')
    .notNull()
    .references(() => agents.id),
  sessionId: text('session_id')
    .notNull()
    .references(() => sessions.id),
  state: text('state').notNull(),
  delta: text('delta'),
  trigger: text('trigger'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
})

export const relationships = sqliteTable('relationships', {
  id: text('id').primaryKey(),
  agentId: text('agent_id')
    .notNull()
    .references(() => agents.id),
  counterpartType: text('counterpart_type', { enum: ['user'] }).notNull(),
  counterpartId: text('counterpart_id').notNull(),
  dimensions: text('dimensions').notNull(),
  history: text('history').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
}, (table) => ({
  counterpartIdx: uniqueIndex('idx_relationships_agent_counterpart').on(
    table.agentId,
    table.counterpartType,
    table.counterpartId,
  ),
  updatedAtIdx: index('idx_relationships_agent_updated_at').on(table.agentId, table.updatedAt),
}))

export const daemonState = sqliteTable('daemon_state', {
  id: text('id').primaryKey(),
  pid: integer('pid').notNull(),
  status: text('status', {
    enum: ['starting', 'running', 'stopping', 'stopped'],
  }).notNull(),
  startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull(),
  lastHeartbeatAt: integer('last_heartbeat_at', { mode: 'timestamp_ms' }).notNull(),
  stoppedAt: integer('stopped_at', { mode: 'timestamp_ms' }),
  lastError: text('last_error'),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
})

export const turingTestRuns = sqliteTable('turing_test_runs', {
  id: text('id').primaryKey(),
  sourceAgentId: text('source_agent_id')
    .notNull()
    .references(() => agents.id),
  tempAgentId: text('temp_agent_id').references(() => agents.id),
  tempSessionId: text('temp_session_id').references(() => sessions.id),
  status: text('status', {
    enum: ['queued', 'preparing', 'running', 'interrupting', 'interrupted', 'completed', 'failed', 'cleaned'],
  }).notNull().default('queued'),
  currentStage: text('current_stage'),
  abortReason: text('abort_reason'),
  judgeProvider: text('judge_provider'),
  judgeModel: text('judge_model'),
  reportJson: text('report_json'),
  transcriptJson: text('transcript_json'),
  error: text('error'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
  startedAt: integer('started_at', { mode: 'timestamp_ms' }),
  finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
  cleanedAt: integer('cleaned_at', { mode: 'timestamp_ms' }),
}, (table) => ({
  statusIdx: index('idx_turing_test_runs_status_created_at').on(table.status, table.createdAt),
  sourceAgentIdx: index('idx_turing_test_runs_source_agent_id').on(table.sourceAgentId, table.createdAt),
}))

export const turingTestEvents = sqliteTable('turing_test_events', {
  id: text('id').primaryKey(),
  runId: text('run_id')
    .notNull()
    .references(() => turingTestRuns.id),
  kind: text('kind').notNull(),
  message: text('message').notNull(),
  payloadJson: text('payload_json'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
}, (table) => ({
  runCreatedAtIdx: index('idx_turing_test_events_run_created_at').on(table.runId, table.createdAt),
}))
