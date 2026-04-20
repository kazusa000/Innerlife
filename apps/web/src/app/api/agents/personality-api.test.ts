import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { agentRepo, getDb, getRawSqlite, resetDb } from '@mas/db'
import { getPersonalityManagerMeta } from './[id]/personality/handler'
import {
  getBigFivePersonalityConfig,
  updateBigFivePersonalityConfig,
} from './[id]/personality/big-five/handler'

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
  `)
  getRawSqlite().exec(`
    INSERT INTO agents (id, name, model, modules) VALUES (
      'agent-1',
      'Agent One',
      'claude-sonnet-4-6',
      '{"personality":{"scheme":"big-five","big5":{"openness":0.68,"conscientiousness":0.61,"extraversion":0.44,"agreeableness":0.72,"neuroticism":0.33},"speechStyle":"冷静、直接","background":"做过多年产品设计"},"emotion":{"scheme":"dimensional","baseline":{"mood":0.2,"energy":0.5,"stress":0.1}},"memory":{"scheme":"sqlite","summarizeModel":"memory-fast"}}'
    );
    INSERT INTO agents (id, name, model, modules) VALUES (
      'agent-2',
      'Agent Two',
      'claude-sonnet-4-6',
      '{"personality":{"scheme":"noop"}}'
    );
    INSERT INTO agents (id, name, model, modules) VALUES (
      'agent-3',
      'Agent Three',
      'claude-sonnet-4-6',
      '{"memory":{"scheme":"sqlite"}}'
    );
  `)
}

test('getPersonalityManagerMeta returns current scheme metadata', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-web-personality-'))
  const dbPath = join(dir, 'test.db')

  try {
    bootstrapDb(dbPath)

    const response = getPersonalityManagerMeta('agent-1')

    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      agentId: 'agent-1',
      scheme: 'big-five',
      supportedSchemes: ['big-five'],
      configured: true,
    })
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('getPersonalityManagerMeta reports noop and missing config as unconfigured', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-web-personality-'))
  const dbPath = join(dir, 'test.db')

  try {
    bootstrapDb(dbPath)

    const noopResponse = getPersonalityManagerMeta('agent-2')
    const missingResponse = getPersonalityManagerMeta('agent-3')

    assert.deepEqual(await noopResponse.json(), {
      agentId: 'agent-2',
      scheme: 'noop',
      supportedSchemes: ['big-five'],
      configured: false,
    })
    assert.deepEqual(await missingResponse.json(), {
      agentId: 'agent-3',
      scheme: null,
      supportedSchemes: ['big-five'],
      configured: false,
    })
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('getBigFivePersonalityConfig returns current personality fields for big-five agents', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-web-personality-'))
  const dbPath = join(dir, 'test.db')

  try {
    bootstrapDb(dbPath)

    const response = getBigFivePersonalityConfig('agent-1')

    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      agentId: 'agent-1',
      scheme: 'big-five',
      big5: {
        openness: 0.68,
        conscientiousness: 0.61,
        extraversion: 0.44,
        agreeableness: 0.72,
        neuroticism: 0.33,
      },
      speechStyle: '冷静、直接',
      background: '做过多年产品设计',
    })
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('getBigFivePersonalityConfig rejects noop and missing personality scheme', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-web-personality-'))
  const dbPath = join(dir, 'test.db')

  try {
    bootstrapDb(dbPath)

    const noopResponse = getBigFivePersonalityConfig('agent-2')
    const missingResponse = getBigFivePersonalityConfig('agent-3')

    assert.equal(noopResponse.status, 400)
    assert.deepEqual(await noopResponse.json(), {
      error: 'Agent personality scheme must be big-five',
    })
    assert.equal(missingResponse.status, 400)
    assert.deepEqual(await missingResponse.json(), {
      error: 'Agent personality scheme must be big-five',
    })
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('updateBigFivePersonalityConfig only mutates modules.personality and preserves sibling modules', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-web-personality-'))
  const dbPath = join(dir, 'test.db')

  try {
    bootstrapDb(dbPath)

    const response = updateBigFivePersonalityConfig('agent-1', {
      big5: {
        openness: 0.91,
        extraversion: 0.57,
      },
      speechStyle: '更克制、更短句',
    })

    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      agentId: 'agent-1',
      scheme: 'big-five',
      big5: {
        openness: 0.91,
        conscientiousness: 0.61,
        extraversion: 0.57,
        agreeableness: 0.72,
        neuroticism: 0.33,
      },
      speechStyle: '更克制、更短句',
      background: '做过多年产品设计',
    })

    assert.deepEqual(agentRepo.getAgent('agent-1')?.modules, {
      personality: {
        scheme: 'big-five',
        big5: {
          openness: 0.91,
          conscientiousness: 0.61,
          extraversion: 0.57,
          agreeableness: 0.72,
          neuroticism: 0.33,
        },
        speechStyle: '更克制、更短句',
        background: '做过多年产品设计',
      },
      emotion: {
        scheme: 'dimensional',
        baseline: {
          mood: 0.2,
          energy: 0.5,
          stress: 0.1,
        },
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
