import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  agentMemorySleepStateRepo,
  agentRepo,
  bootstrapAppDatabases,
  daemonEventRepo,
  daemonStateRepo,
  getMemoryRawSqlite,
  getRawSqlite,
  messageRepo,
  resetDb,
  resetMemoryDb,
  sessionContextStateRepo,
  sessionRepo,
  turingRunRepo,
} from '@mas/db'
import {
  getDaemonContextFlushList,
  getDaemonEventsFeed,
  getDaemonOverview,
  getDaemonSleepList,
  getDaemonTuringRunSummaries,
  runDaemonContextFlush,
  runDaemonSleep,
} from './handler'

function bootstrap(dbPath: string, memoryDbPath: string) {
  process.env.MAS_MEMORY_DB_PATH = memoryDbPath
  process.env.MAS_DAEMON_TICK_INTERVAL_MS = '7000'
  resetDb()
  resetMemoryDb()
  bootstrapAppDatabases({ dbPath, memoryDbPath })
}

function seedBaseData() {
  const sqliteAgent = agentRepo.createAgent({
    name: 'SQLite Agent',
    provider: 'openrouter',
    model: 'qwen/qwen3.5-flash-02-23',
    modules: {
      memory: {
        scheme: 'sqlite',
        contextWindowMessages: 3,
        contextIdleFlushMinutes: 30,
        sleepEnabled: true,
        sleepTimeLocal: '00:00',
        sleepIntervalDays: 1,
      },
    },
  })!
  const noopAgent = agentRepo.createAgent({
    name: 'Noop Agent',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    modules: {
      memory: {
        scheme: 'noop',
      },
    },
  })!

  const activeSession = sessionRepo.createSession(sqliteAgent.id, 'context session')
  sessionRepo.createSession(noopAgent.id, 'noop session')

  messageRepo.addMessage({
    sessionId: activeSession.id,
    role: 'user',
    content: JSON.stringify([{ type: 'text', text: 'hello' }]),
  })
  messageRepo.addMessage({
    sessionId: activeSession.id,
    role: 'assistant',
    content: JSON.stringify([{ type: 'text', text: 'hi' }]),
  })
  messageRepo.addMessage({
    sessionId: activeSession.id,
    role: 'user',
    content: JSON.stringify([{ type: 'text', text: 'memory please' }]),
  })
  messageRepo.addMessage({
    sessionId: activeSession.id,
    role: 'assistant',
    content: JSON.stringify([{ type: 'text', text: 'noted' }]),
  })
  messageRepo.addMessage({
    sessionId: activeSession.id,
    role: 'user',
    content: JSON.stringify([{ type: 'text', text: 'one more thing' }]),
  })
  const firstMessageId = messageRepo.getSessionMessages(activeSession.id)[0]?.id ?? null

  sessionContextStateRepo.upsertSessionContextState({
    sessionId: activeSession.id,
    activeStartMessageId: firstMessageId,
    lastUserMessageAt: new Date('2026-04-22T08:00:00.000Z'),
    lastContextFlushAt: new Date('2026-04-22T07:00:00.000Z'),
  })

  agentMemorySleepStateRepo.upsertAgentMemorySleepState({
    agentId: sqliteAgent.id,
    lastSleepAt: new Date('2026-04-21T00:00:00.000Z'),
  })

  getMemoryRawSqlite().exec(`
    INSERT INTO memories (
      id,
      agent_id,
      session_id,
      layer,
      source_text,
      display_summary,
      retrieval_text,
      retrieval_embedding,
      retrieval_model,
      tags,
      importance,
      created_at
    ) VALUES (
      'memory-1',
      '${sqliteAgent.id}',
      '${activeSession.id}',
      'short_term',
      'source',
      'summary',
      'retrieval',
      '[]',
      'test-embedding',
      '[]',
      0.9,
      unixepoch('now') * 1000
    );
  `)

  daemonStateRepo.markDaemonRunning({
    pid: 4242,
    startedAt: new Date('2026-04-22T09:00:00.000Z'),
    lastHeartbeatAt: new Date('2026-04-22T09:01:00.000Z'),
  })
  daemonEventRepo.appendEvent({
    kind: 'run_completed',
    scope: 'turing',
    message: 'turing run completed',
    payload: { runId: 'run-1' },
    createdAt: new Date('2026-04-22T09:02:00.000Z'),
  })
  daemonEventRepo.appendEvent({
    kind: 'flush_success',
    scope: 'memory_flush',
    message: 'context flush completed',
    payload: { sessionId: activeSession.id, createdCount: 2 },
    createdAt: new Date('2026-04-22T09:03:00.000Z'),
  })
  daemonEventRepo.appendEvent({
    kind: 'sleep_success',
    scope: 'memory_sleep',
    message: 'sleep completed',
    payload: { agentId: sqliteAgent.id, createdCount: 1 },
    createdAt: new Date('2026-04-22T09:04:00.000Z'),
  })

  const run = turingRunRepo.createRun({
    sourceAgentId: sqliteAgent.id,
    judgeProvider: 'openrouter',
    judgeModel: 'qwen/qwen3.5-flash-02-23',
  })
  turingRunRepo.setRunStatus(run.id, {
    status: 'running',
    currentStage: 'daily_flow',
    startedAt: new Date('2026-04-22T09:00:00.000Z'),
  })

  return {
    sqliteAgent,
    activeSession,
    runId: run.id,
  }
}

test('getDaemonOverview returns daemon state and recent event counts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-daemon-api-'))
  const dbPath = join(dir, 'data.db')
  const memoryDbPath = join(dir, 'memory.db')

  try {
    bootstrap(dbPath, memoryDbPath)
    seedBaseData()

    const response = await getDaemonOverview()
    assert.equal(response.status, 200)
    const data = await response.json()

    assert.equal(data.daemon.pid, 4242)
    assert.equal(data.tickIntervalMs, 7000)
    assert.deepEqual(data.recentEventCounts, {
      total: 3,
      daemon: 0,
      turing: 1,
      memoryFlush: 1,
      memorySleep: 1,
    })
  } finally {
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('getDaemonEventsFeed returns newest-first daemon events', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-daemon-api-'))
  const dbPath = join(dir, 'data.db')
  const memoryDbPath = join(dir, 'memory.db')

  try {
    bootstrap(dbPath, memoryDbPath)
    const { activeSession } = seedBaseData()
    daemonEventRepo.appendEvent({
      kind: 'flush_failed',
      scope: 'memory_flush',
      message: 'context flush failed',
      payload: { sessionId: activeSession.id },
      createdAt: new Date('2026-04-22T09:05:00.000Z'),
    })

    const response = await getDaemonEventsFeed()
    assert.equal(response.status, 200)
    const data = await response.json()

    assert.equal(data.events[0].kind, 'flush_failed')
    assert.equal(data.events[0].scope, 'memory_flush')
    assert.equal(data.events[0].payload.sessionId, activeSession.id)
  } finally {
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('getDaemonTuringRunSummaries returns recent runs with source agent names', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-daemon-api-'))
  const dbPath = join(dir, 'data.db')
  const memoryDbPath = join(dir, 'memory.db')

  try {
    bootstrap(dbPath, memoryDbPath)
    const { sqliteAgent, runId } = seedBaseData()

    const response = await getDaemonTuringRunSummaries()
    assert.equal(response.status, 200)
    const data = await response.json()

    assert.equal(data.runs[0].id, runId)
    assert.equal(data.runs[0].sourceAgentId, sqliteAgent.id)
    assert.equal(data.runs[0].sourceAgentName, 'SQLite Agent')
    assert.equal(data.runs[0].currentStage, 'daily_flow')
  } finally {
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('getDaemonContextFlushList returns sqlite active sessions with flush recommendation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-daemon-api-'))
  const dbPath = join(dir, 'data.db')
  const memoryDbPath = join(dir, 'memory.db')

  try {
    bootstrap(dbPath, memoryDbPath)
    const { activeSession, sqliteAgent } = seedBaseData()

    const response = await getDaemonContextFlushList({
      now: new Date('2026-04-22T10:00:00.000Z'),
    })
    assert.equal(response.status, 200)
    const data = await response.json()

    assert.equal(data.sessions.length, 1)
    assert.equal(data.sessions[0].sessionId, activeSession.id)
    assert.equal(data.sessions[0].agentId, sqliteAgent.id)
    assert.equal(data.sessions[0].activeMessageCount, 5)
    assert.equal(data.sessions[0].canFlush, true)
    assert.equal(data.sessions[0].flushReason, 'overflow')
  } finally {
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('runDaemonContextFlush delegates to runContextFlushForSession with the submitted sessionId', async () => {
  const response = await runDaemonContextFlush({ sessionId: 'session-1' }, {
    async runContextFlushForSession(input) {
      assert.deepEqual(input, {
        sessionId: 'session-1',
        mode: 'manual',
      })
      return {
        ok: true as const,
        mode: 'manual' as const,
        createdCount: 2,
        memoryIds: ['memory-1', 'memory-2'],
      }
    },
  })

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    sessionId: 'session-1',
    result: {
      ok: true,
      mode: 'manual',
      createdCount: 2,
      memoryIds: ['memory-1', 'memory-2'],
    },
  })
})

test('getDaemonSleepList returns sqlite agents with short-term counts and due status', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-daemon-api-'))
  const dbPath = join(dir, 'data.db')
  const memoryDbPath = join(dir, 'memory.db')

  try {
    bootstrap(dbPath, memoryDbPath)
    const { sqliteAgent } = seedBaseData()

    const response = await getDaemonSleepList({
      now: new Date('2026-04-22T10:00:00.000Z'),
    })
    assert.equal(response.status, 200)
    const data = await response.json()

    assert.equal(data.agents.length, 1)
    assert.equal(data.agents[0].agentId, sqliteAgent.id)
    assert.equal(data.agents[0].shortTermCount, 1)
    assert.equal(data.agents[0].canSleep, true)
    assert.equal(data.agents[0].sleepTimeLocal, '00:00')
  } finally {
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('runDaemonSleep delegates to runSleepForAgent with the submitted agentId', async () => {
  const response = await runDaemonSleep({ agentId: 'agent-1' }, {
    async runSleepForAgent(input) {
      assert.deepEqual(input, {
        agentId: 'agent-1',
        mode: 'manual',
      })
      return {
        ok: true as const,
        createdCount: 1,
        memoryIds: ['memory-9'],
        deletedShortTermCount: 3,
      }
    },
  })

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    agentId: 'agent-1',
    result: {
      ok: true,
      createdCount: 1,
      memoryIds: ['memory-9'],
      deletedShortTermCount: 3,
    },
  })
})
