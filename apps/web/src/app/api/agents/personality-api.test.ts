import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { agentRepo, getDb, getRawSqlite, resetDb } from '@mas/db'
import {
  getPersonalityConfig,
  updatePersonalityConfig,
} from './[id]/personality/handler'

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
      '{"personality":{"scheme":"big-five","prompt":"回答时保持克制、像真实朋友，不要过度热情。"},"emotion":{"scheme":"dimensional","baseline":{"mood":0.2,"energy":0.5,"stress":0.1}},"memory":{"scheme":"sqlite","summarizeModel":"memory-fast"}}'
    );
    INSERT INTO agents (id, name, model, modules) VALUES (
      'agent-2',
      'Agent Two',
      'claude-sonnet-4-6',
      '{"personality":{"systemPrompt":"不要自称 AI。","personaPrompt":"像朋友一样聊天。","avatarUrl":"https://example.com/hazel.png","thinkingRoleImmersionPrompt":"只在 think 中内心独白。"}}'
    );
    INSERT INTO agents (id, name, model, modules) VALUES (
      'agent-3',
      'Agent Three',
      'claude-sonnet-4-6',
      '{"memory":{"scheme":"sqlite"}}'
    );
    UPDATE agents
      SET config = '{"provider":"anthropic","systemPrompt":"保持真实。","personaPrompt":"少一点客服感。"}'
      WHERE id = 'agent-1';
  `)
}

test('getPersonalityConfig returns migrated persona prompts from modules.personality', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-web-personality-'))
  const dbPath = join(dir, 'test.db')

  try {
    bootstrapDb(dbPath)

    const response = getPersonalityConfig('agent-1')

    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      agentId: 'agent-1',
      systemPrompt: '保持真实。',
      personaPrompt: '少一点客服感。',
      avatarUrl: '',
      thinkingRoleImmersionPrompt: '',
    })
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('getPersonalityConfig returns empty strings when persona prompts are absent', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-web-personality-'))
  const dbPath = join(dir, 'test.db')

  try {
    bootstrapDb(dbPath)

    const configuredResponse = getPersonalityConfig('agent-2')
    const missingResponse = getPersonalityConfig('agent-3')

    assert.deepEqual(await configuredResponse.json(), {
      agentId: 'agent-2',
      systemPrompt: '不要自称 AI。',
      personaPrompt: '像朋友一样聊天。',
      avatarUrl: 'https://example.com/hazel.png',
      thinkingRoleImmersionPrompt: '只在 think 中内心独白。',
    })
    assert.deepEqual(await missingResponse.json(), {
      agentId: 'agent-3',
      systemPrompt: '',
      personaPrompt: '',
      avatarUrl: '',
      thinkingRoleImmersionPrompt: '',
    })
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('updatePersonalityConfig only mutates modules.personality prompts and preserves sibling modules', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-web-personality-'))
  const dbPath = join(dir, 'test.db')

  try {
    bootstrapDb(dbPath)

    const response = updatePersonalityConfig('agent-1', {
      systemPrompt: '不要暴露你是 AI。',
      personaPrompt: '像熟人一样，短句回复。',
      avatarUrl: 'data:image/png;base64,abc123',
      thinkingRoleImmersionPrompt: '自定义思考规则。',
    })

    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      agentId: 'agent-1',
      systemPrompt: '不要暴露你是 AI。',
      personaPrompt: '像熟人一样，短句回复。',
      avatarUrl: 'data:image/png;base64,abc123',
      thinkingRoleImmersionPrompt: '自定义思考规则。',
    })

    assert.deepEqual(agentRepo.getAgent('agent-1')?.modules, {
      personality: {
        systemPrompt: '不要暴露你是 AI。',
        personaPrompt: '像熟人一样，短句回复。',
        avatarUrl: 'data:image/png;base64,abc123',
        thinkingRoleImmersionPrompt: '自定义思考规则。',
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

    const rawAgent = getRawSqlite()
      .prepare('SELECT config FROM agents WHERE id = ?')
      .get('agent-1') as { config: string | null }
    assert.equal(rawAgent.config, '{"provider":"anthropic"}')
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})
