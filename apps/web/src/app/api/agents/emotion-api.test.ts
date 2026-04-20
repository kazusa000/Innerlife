import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { agentRepo, emotionStateRepo, getDb, getRawSqlite, resetDb } from '@mas/db'
import { getEmotionManagerMeta } from './[id]/emotion/handler'
import {
  getDimensionalEmotionConfig,
  updateDimensionalEmotionConfig,
} from './[id]/emotion/dimensional/handler'

function bootstrapDb(dbPath: string) {
  resetDb()
  getDb(dbPath)
  getRawSqlite().exec(`
    CREATE TABLE agents (
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
    CREATE TABLE emotion_states (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      state TEXT NOT NULL,
      delta TEXT,
      trigger TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    );
    CREATE INDEX idx_emotion_states_agent_created_at
      ON emotion_states(agent_id, created_at);
  `)
  getRawSqlite().exec(`
    INSERT INTO agents (id, name, model, modules) VALUES (
      'agent-1',
      'Agent One',
      'claude-sonnet-4-6',
      '{"emotion":{"scheme":"dimensional","baseline":{"mood":0.35,"energy":0.62,"stress":0.18},"decayPerTurn":0.12,"analysisModel":"emotion-fast"},"memory":{"scheme":"sqlite","summarizeModel":"memory-fast"}}'
    );
    INSERT INTO agents (id, name, model, modules) VALUES (
      'agent-2',
      'Agent Two',
      'claude-sonnet-4-6',
      '{"emotion":{"scheme":"noop"}}'
    );
    INSERT INTO agents (id, name, model, modules) VALUES (
      'agent-3',
      'Agent Three',
      'claude-sonnet-4-6',
      '{"memory":{"scheme":"sqlite"}}'
    );
  `)

  const first = emotionStateRepo.addEmotionState({
    agentId: 'agent-1',
    sessionId: 'session-a',
    state: { mood: 0.4, energy: 0.58, stress: 0.2 },
    delta: { mood: 0.1, energy: -0.02, stress: 0.05 },
    trigger: '用户分享了一个好消息',
  })
  const second = emotionStateRepo.addEmotionState({
    agentId: 'agent-1',
    sessionId: 'session-b',
    state: { mood: 0.28, energy: 0.49, stress: 0.26 },
    delta: { mood: -0.08, energy: -0.03, stress: 0.06 },
    trigger: '用户提到工作延期',
  })
  getRawSqlite().exec(`
    UPDATE emotion_states SET created_at = 1713549600000 WHERE id = '${first.id}';
    UPDATE emotion_states SET created_at = 1713553200000 WHERE id = '${second.id}';
  `)
}

test('getEmotionManagerMeta returns current scheme metadata', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-web-emotion-'))
  const dbPath = join(dir, 'test.db')

  try {
    bootstrapDb(dbPath)

    const response = getEmotionManagerMeta('agent-1')

    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      agentId: 'agent-1',
      scheme: 'dimensional',
      supportedSchemes: ['dimensional'],
      configured: true,
    })
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('getEmotionManagerMeta reports noop and missing config as unconfigured', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-web-emotion-'))
  const dbPath = join(dir, 'test.db')

  try {
    bootstrapDb(dbPath)

    const noopResponse = getEmotionManagerMeta('agent-2')
    const missingResponse = getEmotionManagerMeta('agent-3')

    assert.deepEqual(await noopResponse.json(), {
      agentId: 'agent-2',
      scheme: 'noop',
      supportedSchemes: ['dimensional'],
      configured: false,
    })
    assert.deepEqual(await missingResponse.json(), {
      agentId: 'agent-3',
      scheme: null,
      supportedSchemes: ['dimensional'],
      configured: false,
    })
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('getDimensionalEmotionConfig returns config and recent history', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-web-emotion-'))
  const dbPath = join(dir, 'test.db')

  try {
    bootstrapDb(dbPath)

    const response = getDimensionalEmotionConfig('agent-1')
    const data = await response.json()

    assert.equal(response.status, 200)
    assert.equal(data.agentId, 'agent-1')
    assert.equal(data.scheme, 'dimensional')
    assert.deepEqual(data.baseline, {
      mood: 0.35,
      energy: 0.62,
      stress: 0.18,
    })
    assert.equal(data.decayPerTurn, 0.12)
    assert.equal(data.analysisModel, 'emotion-fast')
    assert.deepEqual(data.currentState, {
      mood: 0.28,
      energy: 0.49,
      stress: 0.26,
    })
    assert.equal(data.history.length, 2)
    assert.equal(data.history[0].trigger, '用户提到工作延期')
    assert.equal(data.history[0].createdAt, '2024-04-19T19:00:00.000Z')
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('getDimensionalEmotionConfig rejects noop and missing emotion scheme', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-web-emotion-'))
  const dbPath = join(dir, 'test.db')

  try {
    bootstrapDb(dbPath)

    const noopResponse = getDimensionalEmotionConfig('agent-2')
    const missingResponse = getDimensionalEmotionConfig('agent-3')

    assert.equal(noopResponse.status, 400)
    assert.deepEqual(await noopResponse.json(), {
      error: 'Agent emotion scheme must be dimensional',
    })
    assert.equal(missingResponse.status, 400)
    assert.deepEqual(await missingResponse.json(), {
      error: 'Agent emotion scheme must be dimensional',
    })
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('updateDimensionalEmotionConfig only mutates modules.emotion and preserves sibling modules', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-web-emotion-'))
  const dbPath = join(dir, 'test.db')

  try {
    bootstrapDb(dbPath)

    const response = updateDimensionalEmotionConfig('agent-1', {
      baseline: {
        mood: -0.3,
        energy: 0.74,
      },
      decayPerTurn: 0.2,
      analysisModel: 'emotion-cheap',
    })

    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      agentId: 'agent-1',
      scheme: 'dimensional',
      baseline: {
        mood: -0.3,
        energy: 0.74,
        stress: 0.18,
      },
      decayPerTurn: 0.2,
      analysisModel: 'emotion-cheap',
      currentState: {
        mood: 0.28,
        energy: 0.49,
        stress: 0.26,
      },
      history: [
        {
          state: { mood: 0.28, energy: 0.49, stress: 0.26 },
          delta: { mood: -0.08, energy: -0.03, stress: 0.06 },
          trigger: '用户提到工作延期',
          createdAt: '2024-04-19T19:00:00.000Z',
        },
        {
          state: { mood: 0.4, energy: 0.58, stress: 0.2 },
          delta: { mood: 0.1, energy: -0.02, stress: 0.05 },
          trigger: '用户分享了一个好消息',
          createdAt: '2024-04-19T18:00:00.000Z',
        },
      ],
    })

    assert.deepEqual(agentRepo.getAgent('agent-1')?.modules, {
      emotion: {
        scheme: 'dimensional',
        baseline: {
          mood: -0.3,
          energy: 0.74,
          stress: 0.18,
        },
        decayPerTurn: 0.2,
        analysisModel: 'emotion-cheap',
      },
      memory: {
        scheme: 'sqlite',
        summarizeModel: 'memory-fast',
      },
    })
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})
