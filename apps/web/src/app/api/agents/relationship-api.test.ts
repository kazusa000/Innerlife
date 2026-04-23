import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { agentRepo, getDb, getRawSqlite, relationshipRepo, resetDb } from '@mas/db'
import { getRelationshipManagerMeta } from './[id]/relationships/handler'
import {
  getMultiDimRelationshipConfig,
  updateMultiDimRelationshipConfig,
} from './[id]/relationships/multi-dim/handler'
import {
  createNamedRelationshipCounterpart,
  deleteNamedRelationshipCounterpart,
  getNamedMultiDimRelationshipConfig,
  renameNamedRelationshipCounterpart,
  updateNamedMultiDimRelationshipConfig,
} from './[id]/relationships/named-multi-dim/handler'

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
    CREATE TABLE relationships (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      counterpart_type TEXT NOT NULL,
      counterpart_id TEXT NOT NULL,
      dimensions TEXT NOT NULL,
      history TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    );
    CREATE TABLE relationship_counterparts (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    );
    CREATE TABLE session_relationship_bindings (
      session_id TEXT PRIMARY KEY,
      counterpart_id TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    );
    CREATE UNIQUE INDEX idx_relationships_agent_counterpart
      ON relationships(agent_id, counterpart_type, counterpart_id);
  `)
  getRawSqlite().exec(`
    INSERT INTO agents (id, name, model, modules) VALUES (
      'agent-1',
      'Agent One',
      'claude-sonnet-4-6',
      '{"relationship":{"scheme":"multi-dim","baseline":{"trust":0.55,"affinity":0.48,"familiarity":0.22,"respect":0.7},"decayPerTurn":0.1,"analysisModel":"relationship-fast","fragmentPrompt":"让关系状态轻微影响亲疏与措辞，不要直说分数。","analysisPrompt":"你负责分析这一轮对关系状态的影响，只输出 JSON。"},"memory":{"scheme":"sqlite","summarizeModel":"memory-fast"}}'
    );
    INSERT INTO agents (id, name, model, modules) VALUES (
      'agent-2',
      'Agent Two',
      'claude-sonnet-4-6',
      '{"relationship":{"scheme":"noop"}}'
    );
    INSERT INTO agents (id, name, model, modules) VALUES (
      'agent-3',
      'Agent Three',
      'claude-sonnet-4-6',
      '{"memory":{"scheme":"sqlite"}}'
    );
    INSERT INTO agents (id, name, model, modules) VALUES (
      'agent-4',
      'Agent Four',
      'claude-sonnet-4-6',
      '{"relationship":{"scheme":"named-multi-dim","baseline":{"trust":0.42,"affinity":0.5,"familiarity":0.15,"respect":0.66},"decayPerTurn":0.12,"analysisModel":"relationship-fast","fragmentPrompt":"把张三或李四的当前关系带进语气。","analysisPrompt":"请判断这一轮对当前对象关系状态的变化，只输出 JSON。"}}'
    );
  `)

  relationshipRepo.upsertRelationship({
    agentId: 'agent-1',
    counterpartId: 'default-user',
    dimensions: {
      trust: 0.63,
      affinity: 0.52,
      familiarity: 0.35,
      respect: 0.74,
    },
    history: [
      {
        summary: '用户主动汇报了昨天的进展',
        trigger: '主动更新',
        delta: {
          trust: 0.08,
          affinity: 0.03,
          familiarity: 0.05,
          respect: 0.02,
        },
        createdAt: '2026-04-19T10:00:00.000Z',
      },
      {
        summary: '用户迟到但诚恳解释',
        trigger: '解释迟到',
        delta: {
          trust: -0.02,
          affinity: 0.01,
          familiarity: 0.02,
          respect: 0,
        },
        createdAt: '2026-04-19T14:00:00.000Z',
      },
    ],
    updatedAt: new Date('2026-04-19T14:00:00.000Z'),
  })
}

test('getRelationshipManagerMeta returns current scheme metadata', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-web-relationship-'))
  const dbPath = join(dir, 'test.db')

  try {
    bootstrapDb(dbPath)

    const response = getRelationshipManagerMeta('agent-1')

    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      agentId: 'agent-1',
      scheme: 'multi-dim',
      supportedSchemes: ['multi-dim', 'named-multi-dim'],
      configured: true,
    })
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('getRelationshipManagerMeta reports noop and missing config as unconfigured', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-web-relationship-'))
  const dbPath = join(dir, 'test.db')

  try {
    bootstrapDb(dbPath)

    const noopResponse = getRelationshipManagerMeta('agent-2')
    const missingResponse = getRelationshipManagerMeta('agent-3')

    assert.deepEqual(await noopResponse.json(), {
      agentId: 'agent-2',
      scheme: 'noop',
      supportedSchemes: ['multi-dim', 'named-multi-dim'],
      configured: false,
    })
    assert.deepEqual(await missingResponse.json(), {
      agentId: 'agent-3',
      scheme: null,
      supportedSchemes: ['multi-dim', 'named-multi-dim'],
      configured: false,
    })
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('named-multi-dim config returns counterpart list and selected counterpart state', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-web-relationship-'))
  const dbPath = join(dir, 'test.db')

  try {
    bootstrapDb(dbPath)

    const zhangsan = (await createNamedRelationshipCounterpart('agent-4', { name: '张三' }).json()).counterpart
    const lisi = (await createNamedRelationshipCounterpart('agent-4', { name: '李四' }).json()).counterpart
    relationshipRepo.upsertRelationship({
      agentId: 'agent-4',
      counterpartId: zhangsan.id,
      counterpartType: 'named',
      dimensions: {
        trust: 0.7,
        affinity: 0.6,
        familiarity: 0.3,
        respect: 0.75,
      },
      history: [
        {
          summary: '张三前天主动分享近况',
          trigger: '主动更新',
          delta: { trust: 0.08, affinity: 0.05, familiarity: 0.04, respect: 0.03 },
          createdAt: '2026-04-22T10:00:00.000Z',
        },
      ],
      updatedAt: new Date('2026-04-22T10:00:00.000Z'),
    })

    const response = getNamedMultiDimRelationshipConfig('agent-4', zhangsan.id)
    const data = await response.json()

    assert.equal(response.status, 200)
    assert.equal(data.scheme, 'named-multi-dim')
    assert.deepEqual(data.counterparts.map((item: { name: string }) => item.name).sort(), ['张三', '李四'])
    assert.equal(data.selectedCounterpart.id, zhangsan.id)
    assert.equal(data.selectedCounterpart.name, '张三')
    assert.deepEqual(data.currentState, {
      trust: 0.7,
      affinity: 0.6,
      familiarity: 0.3,
      respect: 0.75,
    })
    assert.equal(data.history.length, 1)
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('named-multi-dim counterpart CRUD and config update work per agent', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-web-relationship-'))
  const dbPath = join(dir, 'test.db')

  try {
    bootstrapDb(dbPath)

    const created = await createNamedRelationshipCounterpart('agent-4', { name: '张三' }).json()
    assert.equal(created.counterpart.name, '张三')

    const renamed = await renameNamedRelationshipCounterpart('agent-4', created.counterpart.id, { name: '王五' }).json()
    assert.equal(renamed.counterpart.name, '王五')

    const updated = await updateNamedMultiDimRelationshipConfig('agent-4', {
      baseline: { trust: 0.6 },
      decayPerTurn: 0.22,
      fragmentPrompt: '根据对象不同调整亲疏分寸。',
    }).json()
    assert.deepEqual(updated.baseline, {
      trust: 0.6,
      affinity: 0.5,
      familiarity: 0.15,
      respect: 0.66,
    })
    assert.equal(updated.decayPerTurn, 0.22)
    assert.equal(updated.fragmentPrompt, '根据对象不同调整亲疏分寸。')

    const deleted = deleteNamedRelationshipCounterpart('agent-4', created.counterpart.id)
    assert.equal(deleted.status, 200)
    const afterDelete = await getNamedMultiDimRelationshipConfig('agent-4').json()
    assert.deepEqual(afterDelete.counterparts, [])
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('getMultiDimRelationshipConfig returns config, current dimensions and history', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-web-relationship-'))
  const dbPath = join(dir, 'test.db')

  try {
    bootstrapDb(dbPath)

    const response = getMultiDimRelationshipConfig('agent-1')
    const data = await response.json()

    assert.equal(response.status, 200)
    assert.deepEqual(data.baseline, {
      trust: 0.55,
      affinity: 0.48,
      familiarity: 0.22,
      respect: 0.7,
    })
    assert.equal(data.decayPerTurn, 0.1)
    assert.equal(data.analysisModel, 'relationship-fast')
    assert.equal(data.fragmentPrompt, '让关系状态轻微影响亲疏与措辞，不要直说分数。')
    assert.equal(data.analysisPrompt, '你负责分析这一轮对关系状态的影响，只输出 JSON。')
    assert.match(data.fragmentPromptDefault, /^当前你与用户的关系状态（会随互动缓慢变化）：/)
    assert.match(data.fragmentPromptDefault, /让这些关系状态轻微影响语气、耐心、亲疏感和措辞/)
    assert.equal(data.fragmentPromptEffective, [
      '当前你与用户的关系状态参考：',
      '- trust：基本信任（0.63）',
      '- affinity：亲和度较高（0.52）',
      '- familiarity：开始熟悉（0.35）',
      '- respect：基本尊重（0.74）',
      '让关系状态轻微影响亲疏与措辞，不要直说分数。',
    ].join('\n'))
    assert.equal(data.analysisPromptDefault, '你负责分析单轮对话对关系状态的影响，只输出 JSON。')
    assert.equal(data.analysisPromptEffective, '你负责分析这一轮对关系状态的影响，只输出 JSON。')
    assert.deepEqual(data.currentState, {
      trust: 0.63,
      affinity: 0.52,
      familiarity: 0.35,
      respect: 0.74,
    })
    assert.equal(data.history.length, 2)
    assert.equal(data.history[0].summary, '用户主动汇报了昨天的进展')
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('getMultiDimRelationshipConfig rejects noop and missing relationship scheme', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-web-relationship-'))
  const dbPath = join(dir, 'test.db')

  try {
    bootstrapDb(dbPath)

    const noopResponse = getMultiDimRelationshipConfig('agent-2')
    const missingResponse = getMultiDimRelationshipConfig('agent-3')

    assert.equal(noopResponse.status, 400)
    assert.deepEqual(await noopResponse.json(), {
      error: 'Agent relationship scheme must be multi-dim',
    })
    assert.equal(missingResponse.status, 400)
    assert.deepEqual(await missingResponse.json(), {
      error: 'Agent relationship scheme must be multi-dim',
    })
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('updateMultiDimRelationshipConfig only mutates modules.relationship and preserves sibling modules', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-web-relationship-'))
  const dbPath = join(dir, 'test.db')

  try {
    bootstrapDb(dbPath)

    const response = updateMultiDimRelationshipConfig('agent-1', {
      baseline: {
        trust: 0.71,
        familiarity: 0.4,
      },
      decayPerTurn: 0.18,
      analysisModel: 'relationship-cheap',
      fragmentPrompt: '关系变化影响语气，但不要显得像系统播报。',
      analysisPrompt: '请判断这轮对 trust/affinity/familiarity/respect 的变化，只输出 JSON。',
    })

    assert.equal(response.status, 200)
    const data = await response.json()
    assert.equal(data.agentId, 'agent-1')
    assert.equal(data.scheme, 'multi-dim')
    assert.deepEqual(data.baseline, {
      trust: 0.71,
      affinity: 0.48,
      familiarity: 0.4,
      respect: 0.7,
    })
    assert.equal(data.decayPerTurn, 0.18)
    assert.equal(data.analysisModel, 'relationship-cheap')
    assert.equal(data.fragmentPrompt, '关系变化影响语气，但不要显得像系统播报。')
    assert.equal(data.analysisPrompt, '请判断这轮对 trust/affinity/familiarity/respect 的变化，只输出 JSON。')
    assert.match(data.fragmentPromptDefault, /^当前你与用户的关系状态（会随互动缓慢变化）：/)
    assert.equal(data.fragmentPromptEffective, [
      '当前你与用户的关系状态参考：',
      '- trust：基本信任（0.63）',
      '- affinity：亲和度较高（0.52）',
      '- familiarity：开始熟悉（0.35）',
      '- respect：基本尊重（0.74）',
      '关系变化影响语气，但不要显得像系统播报。',
    ].join('\n'))
    assert.equal(data.analysisPromptDefault, '你负责分析单轮对话对关系状态的影响，只输出 JSON。')
    assert.equal(data.analysisPromptEffective, '请判断这轮对 trust/affinity/familiarity/respect 的变化，只输出 JSON。')
    assert.deepEqual(data.currentState, {
      trust: 0.63,
      affinity: 0.52,
      familiarity: 0.35,
      respect: 0.74,
    })
    assert.equal(data.history.length, 2)

    assert.deepEqual(agentRepo.getAgent('agent-1')?.modules, {
      relationship: {
        scheme: 'multi-dim',
        baseline: {
          trust: 0.71,
          affinity: 0.48,
          familiarity: 0.4,
          respect: 0.7,
        },
        decayPerTurn: 0.18,
        analysisModel: 'relationship-cheap',
        fragmentPrompt: '关系变化影响语气，但不要显得像系统播报。',
        analysisPrompt: '请判断这轮对 trust/affinity/familiarity/respect 的变化，只输出 JSON。',
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
