import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  agentMemorySleepStateRepo,
  agentRepo,
  bootstrapAppDatabases,
  emotionStateRepo,
  getMemoryRawSqlite,
  messageRepo,
  relationshipRepo,
  resetDb,
  resetMemoryDb,
  sessionContextStateRepo,
  sessionRepo,
  turingEventRepo,
  turingRunRepo,
} from '@mas/db'
import { deleteAgentCascade } from './[id]/handler'

function bootstrap(dbPath: string, memoryDbPath: string) {
  process.env.MAS_MEMORY_DB_PATH = memoryDbPath
  resetDb()
  resetMemoryDb()
  bootstrapAppDatabases({ dbPath, memoryDbPath })
}

test('deleteAgentCascade removes agent data across session, turing, daemon memory and state tables', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-agent-delete-'))
  const dbPath = join(dir, 'data.db')
  const memoryDbPath = join(dir, 'memory.db')

  try {
    bootstrap(dbPath, memoryDbPath)

    const agent = agentRepo.createAgent({
      name: 'Delete Me',
      provider: 'openrouter',
      model: 'qwen/qwen3.5-flash-02-23',
      modules: {
        memory: {
          scheme: 'sqlite',
        },
      },
    })!

    const session = sessionRepo.createSession(agent.id, 'session')
    const userMessageId = messageRepo.addMessage({
      sessionId: session.id,
      role: 'user',
      content: JSON.stringify([{ type: 'text', text: 'hello' }]),
    })

    sessionContextStateRepo.upsertSessionContextState({
      sessionId: session.id,
      activeStartMessageId: userMessageId,
    })

    emotionStateRepo.addEmotionState({
      agentId: agent.id,
      sessionId: session.id,
      state: { mood: 0, energy: 0.2, stress: 0.3 },
      delta: null,
      trigger: 'seed',
    })

    relationshipRepo.upsertRelationship({
      agentId: agent.id,
      counterpartId: 'default-user',
      dimensions: { trust: 0.5, affinity: 0.5, familiarity: 0.1, respect: 0.5 },
      history: [],
    })

    agentMemorySleepStateRepo.upsertAgentMemorySleepState({
      agentId: agent.id,
      lastSleepAt: new Date('2026-04-22T00:00:00.000Z'),
    })

    const run = turingRunRepo.createRun({
      sourceAgentId: agent.id,
      judgeProvider: 'openrouter',
      judgeModel: 'qwen/qwen3.5-flash-02-23',
    })
    turingEventRepo.appendEvent({
      runId: run.id,
      kind: 'run_created',
      message: 'created',
    })

    getMemoryRawSqlite()
      .prepare(`
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
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        'memory-1',
        agent.id,
        session.id,
        'short_term',
        'source',
        'summary',
        'retrieval',
        '[]',
        'test-embedding',
        '[]',
        0.8,
        Date.now(),
      )

    const response = deleteAgentCascade(agent.id)

    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { ok: true })
    assert.equal(agentRepo.getAgent(agent.id), undefined)
    assert.equal(sessionRepo.listSessionsByAgent(agent.id).length, 0)
    assert.equal(sessionContextStateRepo.getSessionContextState(session.id), undefined)
    assert.equal(emotionStateRepo.getLatestEmotionStateByAgent(agent.id), undefined)
    assert.equal(relationshipRepo.getRelationship(agent.id, 'default-user'), undefined)
    assert.equal(agentMemorySleepStateRepo.getAgentMemorySleepState(agent.id), undefined)
    assert.equal(turingRunRepo.listRunsBySourceAgent(agent.id).length, 0)

    const memoryRows = getMemoryRawSqlite()
      .prepare('SELECT COUNT(*) as count FROM memories WHERE agent_id = ?')
      .get(agent.id) as { count: number }
    assert.equal(memoryRows.count, 0)
  } finally {
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})
