import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { agentRepo, bootstrapAppDatabases, resetDb, resetMemoryDb } from '@mas/db'
import { GET, PATCH } from './route'

function bootstrap(dbPath: string, memoryDbPath: string) {
  process.env.MAS_MEMORY_DB_PATH = memoryDbPath
  resetDb()
  resetMemoryDb()
  bootstrapAppDatabases({ dbPath, memoryDbPath })
}

test('tools route lists effective tool states for an agent', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-agent-tools-route-'))
  const dbPath = join(dir, 'data.db')
  const memoryDbPath = join(dir, 'memory.db')

  try {
    bootstrap(dbPath, memoryDbPath)

    const agent = agentRepo.createAgent({
      name: 'Tooly',
      model: 'claude-sonnet-4-6',
      modules: {
        memory: {
          scheme: 'sqlite',
        },
      },
    })!

    const response = await GET(new Request('http://localhost'), {
      params: Promise.resolve({ id: agent.id }),
    })

    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.equal(payload.agentId, agent.id)
    assert.equal(payload.tools.length, 2)
    assert.deepEqual(
      payload.tools.map((tool: { name: string; effectiveEnabled: boolean }) => [tool.name, tool.effectiveEnabled]),
      [
        ['search_long_term_memory', true],
        ['web_fetch', false],
      ],
    )
  } finally {
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('tools route persists enabled state and description override', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-agent-tools-route-'))
  const dbPath = join(dir, 'data.db')
  const memoryDbPath = join(dir, 'memory.db')

  try {
    bootstrap(dbPath, memoryDbPath)

    const agent = agentRepo.createAgent({
      name: 'Tooly',
      model: 'claude-sonnet-4-6',
      modules: {
        memory: {
          scheme: 'noop',
        },
      },
    })!

    const response = await PATCH(
      new Request('http://localhost', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tools: {
            web_fetch: {
              enabled: true,
              description: '抓取网页正文，忽略无关导航和广告。',
            },
            search_long_term_memory: {
              description: '只有在确实需要追溯旧互动时才查长期记忆。',
            },
          },
        }),
      }),
      {
        params: Promise.resolve({ id: agent.id }),
      },
    )

    assert.equal(response.status, 200)
    const payload = await response.json()
    const webFetch = payload.tools.find((tool: { name: string }) => tool.name === 'web_fetch')
    const longTermSearch = payload.tools.find((tool: { name: string }) => tool.name === 'search_long_term_memory')

    assert.equal(webFetch?.configuredEnabled, true)
    assert.equal(webFetch?.effectiveEnabled, true)
    assert.equal(webFetch?.effectiveDescription, '抓取网页正文，忽略无关导航和广告。')

    assert.equal(longTermSearch?.configuredEnabled, true)
    assert.equal(longTermSearch?.effectiveEnabled, false)
    assert.equal(longTermSearch?.unavailableReason, '仅当记忆方案为 sqlite 时才可生效。')

    const updated = agentRepo.getAgent(agent.id)
    assert.deepEqual(updated?.tools, {
      web_fetch: {
        enabled: true,
        description: '抓取网页正文，忽略无关导航和广告。',
      },
      search_long_term_memory: {
        description: '只有在确实需要追溯旧互动时才查长期记忆。',
      },
    })
  } finally {
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})
