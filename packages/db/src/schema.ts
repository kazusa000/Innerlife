import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

export const agents = sqliteTable('agents', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  personality: text('personality'),
  skills: text('skills'),
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

export const llmCalls = sqliteTable('llm_calls', {
  id: text('id').primaryKey(),
  sessionId: text('session_id')
    .notNull()
    .references(() => sessions.id),
  userMessageId: text('user_message_id')
    .notNull()
    .references(() => messages.id),
  turnIndex: integer('turn_index').notNull(),
  model: text('model').notNull(),
  systemPrompt: text('system_prompt').notNull(),
  toolsJson: text('tools_json').notNull(),
  messagesJson: text('messages_json').notNull(),
  responseJson: text('response_json'),
  stopReason: text('stop_reason'),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull(),
  finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
  error: text('error'),
})
