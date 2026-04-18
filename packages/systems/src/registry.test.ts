import assert from 'node:assert/strict'
import test from 'node:test'
import { createSystems } from './registry'

function createTurnContext() {
  return {
    agentId: 'agent-1',
    sessionId: 'session-1',
    userId: 'user-1',
    input: { raw: 'hi', text: 'hi', modality: 'text' as const },
    state: {},
    promptFragments: [],
    messages: [],
  }
}

test('createSystems returns empty for null and noop modules', () => {
  assert.deepEqual(createSystems(null), [])
  assert.deepEqual(createSystems({ debug: 'noop' }), [])
})

test('createSystems instantiates hello-world debug system from string scheme', async () => {
  const [system] = createSystems({ debug: 'hello-world' })
  assert.equal(system?.name, 'debug:hello-world')

  const ctx = createTurnContext()

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

test('createSystems treats disabled values configs as noop', () => {
  assert.deepEqual(createSystems({ values: { scheme: 'noop' } }), [])
  assert.deepEqual(createSystems({ values: {} }), [])
})

test('createSystems instantiates values priority-list system and preserves order', async () => {
  const [system] = createSystems({
    values: {
      scheme: 'priority-list',
      priorities: ['A', 'B', 'C'],
    },
  })

  assert.equal(system?.name, 'values:priority-list')

  const ctx = createTurnContext()
  await system?.beforeLLM?.(ctx)

  assert.deepEqual(ctx.promptFragments, [
    {
      source: 'values:priority-list',
      priority: 50,
      content: 'Values (in priority order):\n1. A\n2. B\n3. C',
    },
  ])
})

test('createSystems skips values fragment when priorities are empty', async () => {
  const [system] = createSystems({
    values: {
      scheme: 'priority-list',
      priorities: [],
    },
  })

  assert.equal(system?.name, 'values:priority-list')

  const ctx = createTurnContext()
  await system?.beforeLLM?.(ctx)

  assert.deepEqual(ctx.promptFragments, [])
})

test('createSystems instantiates summary compaction system from string scheme', () => {
  const [system] = createSystems({ compaction: 'summary' })
  assert.equal(system?.name, 'compaction:summary')
  assert.equal(system?.type, 'compaction')
})

test('createSystems treats noop emotion configs as disabled', () => {
  assert.deepEqual(createSystems({ emotion: { scheme: 'noop' } }), [])
  assert.deepEqual(createSystems({ emotion: {} }), [])
})
