import { runAgent, AnthropicProvider, BashTool } from '@mas/core'
import type { AgentConfig, Message } from '@mas/core'
import { getDb, agentRepo, sessionRepo, messageRepo, schema } from '@mas/db'
import { eq } from 'drizzle-orm'

// Initialize DB tables on first import via raw SQL (simple bootstrap, no migrations needed)
function initDb() {
  const db = getDb()
  const sqlite = (db as any)._.session.client as import('better-sqlite3').Database
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      personality TEXT,
      skills TEXT,
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
  `)
}

function ensureDefaults() {
  initDb()

  let agent = agentRepo.listAgents()[0]
  if (!agent) {
    agent = agentRepo.createAgent({
      name: 'Default Agent',
      description: 'A helpful AI assistant that can execute bash commands.',
      model: 'claude-sonnet-4-6',
    })!
  }

  const db = getDb()
  const existingSession = db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.agentId, agent.id))
    .get()

  if (existingSession) return existingSession

  return sessionRepo.createSession(agent.id, 'Default Chat')
}

let defaultSessionId: string | null = null

function getDefaultSessionId(): string {
  if (!defaultSessionId) {
    const session = ensureDefaults()
    defaultSessionId = session.id
  }
  return defaultSessionId
}

export async function POST(request: Request) {
  const body = await request.json()
  const userMessage = body.message as string
  const sessionId = (body.sessionId as string) || getDefaultSessionId()

  messageRepo.addMessage({
    sessionId,
    role: 'user',
    content: JSON.stringify([{ type: 'text', text: userMessage }]),
  })

  const dbMessages = messageRepo.getSessionMessages(sessionId)
  const messages: Message[] = dbMessages.map((m) => ({
    role: m.role as Message['role'],
    content: JSON.parse(m.content),
  }))

  const provider = new AnthropicProvider()
  const config: AgentConfig = {
    id: 'default',
    model: 'claude-sonnet-4-6',
    systemPrompt:
      'You are a helpful AI assistant. You can execute bash commands to help the user. Be concise.',
    tools: [BashTool],
    maxTurns: 10,
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of runAgent(config, messages, provider)) {
          const data = JSON.stringify(event)
          controller.enqueue(encoder.encode(`data: ${data}\n\n`))

          if (event.type === 'complete') {
            messageRepo.addMessage({
              sessionId,
              role: 'assistant',
              content: JSON.stringify(event.response.content),
              tokenCount: event.response.usage.outputTokens,
            })
          }
        }
      } catch (err) {
        const errorEvent = JSON.stringify({
          type: 'error',
          error: err instanceof Error ? err.message : String(err),
        })
        controller.enqueue(encoder.encode(`data: ${errorEvent}\n\n`))
      } finally {
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
