import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getDb, getRawSqlite, resetDb } from '../client'
import {
  createRelationshipCounterpart,
  deleteRelationshipCounterpart,
  getRelationshipCounterpart,
  listRelationshipCounterpartsByAgent,
  updateRelationshipCounterpart,
} from './relationship-counterparts'

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
    CREATE TABLE relationship_counterparts (
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
    CREATE INDEX idx_relationship_counterparts_agent_updated_at
      ON relationship_counterparts(agent_id, updated_at);
  `)
  getRawSqlite().exec(`
    INSERT INTO agents (id, name, model) VALUES ('agent-1', 'Hazel', 'deepseek-chat');
    INSERT INTO agents (id, name, model) VALUES ('agent-2', 'Orion', 'deepseek-chat');
  `)
}

test('relationship counterpart repo creates, lists, renames, and deletes counterparts per agent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-relationship-counterparts-'))
  const dbPath = join(dir, 'test.db')

  try {
    bootstrapDb(dbPath)

    const zhangsan = createRelationshipCounterpart({
      agentId: 'agent-1',
      name: '张三',
      avatarUrl: ' https://example.test/zhangsan.png ',
      role: '旧友',
      description: '长期参与测试的用户',
      note: '我觉得他说话很敏锐',
    })
    const lisi = createRelationshipCounterpart({ agentId: 'agent-1', name: '李四' })
    const agentTwoZhangsan = createRelationshipCounterpart({ agentId: 'agent-2', name: '张三' })

    assert.equal(getRelationshipCounterpart(zhangsan.id)?.name, '张三')
    assert.deepEqual(getRelationshipCounterpart(zhangsan.id), {
      id: zhangsan.id,
      agentId: 'agent-1',
      name: '张三',
      avatarUrl: 'https://example.test/zhangsan.png',
      role: '旧友',
      description: '长期参与测试的用户',
      note: '我觉得他说话很敏锐',
      createdAt: zhangsan.createdAt,
      updatedAt: zhangsan.updatedAt,
    })
    assert.equal(getRelationshipCounterpart(agentTwoZhangsan.id)?.agentId, 'agent-2')

    assert.deepEqual(
      listRelationshipCounterpartsByAgent('agent-1').map((item) => item.name).sort(),
      ['张三', '李四'],
    )
    assert.deepEqual(
      listRelationshipCounterpartsByAgent('agent-2').map((item) => item.name),
      ['张三'],
    )

    const renamed = updateRelationshipCounterpart(zhangsan.id, {
      name: '王五',
      avatarUrl: '',
      role: '朋友',
      note: null,
    })
    assert.equal(renamed?.name, '王五')
    assert.equal(renamed?.avatarUrl, null)
    assert.equal(renamed?.role, '朋友')
    assert.equal(renamed?.description, '长期参与测试的用户')
    assert.equal(renamed?.note, null)

    deleteRelationshipCounterpart(lisi.id)
    assert.deepEqual(
      listRelationshipCounterpartsByAgent('agent-1').map((item) => item.name),
      ['王五'],
    )
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})
