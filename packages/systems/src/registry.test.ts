import assert from 'node:assert/strict'
import test from 'node:test'
import { createSystems } from './registry'

test('createSystems returns empty for null and noop modules', () => {
  assert.deepEqual(createSystems(null), [])
  assert.deepEqual(createSystems({ debug: 'noop' }), [])
})

test('createSystems instantiates hello-world debug system from string scheme', async () => {
  const [system] = createSystems({ debug: 'hello-world' })
  assert.equal(system?.name, 'debug:hello-world')

  const ctx = {
    agentId: 'agent-1',
    sessionId: 'session-1',
    userId: 'user-1',
    input: { raw: 'hi', text: 'hi', modality: 'text' as const },
    state: {},
    promptFragments: [],
    messages: [],
  }

  await system?.beforeLLM?.(ctx)

  assert.deepEqual(ctx.promptFragments, [
    {
      source: 'debug:hello-world',
      priority: 100,
      content: '(Debug: hello from system)',
    },
  ])
})

test('createSystems accepts object scheme configuration', () => {
  const systems = createSystems({ debug: { scheme: 'hello-world' } })
  assert.equal(systems[0]?.name, 'debug:hello-world')
})

test('createSystems instantiates summary compaction system from string scheme', () => {
  const [system] = createSystems({ compaction: 'summary' })
  assert.equal(system?.name, 'compaction:summary')
  assert.equal(system?.type, 'compaction')
})
