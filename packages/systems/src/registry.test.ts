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
    turnMetadata: {},
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

test('createSystems ignores legacy values configs', () => {
  assert.deepEqual(createSystems({ values: { scheme: 'priority-list' } }), [])
  assert.deepEqual(createSystems({ values: { scheme: 'noop' } }), [])
})

test('createSystems instantiates summary compaction system from string scheme', () => {
  const [system] = createSystems({ compaction: 'summary' })
  assert.equal(system?.name, 'compaction:summary')
  assert.equal(system?.type, 'compaction')
})

test('createSystems instantiates sqlite memory system from object config', () => {
  const [system] = createSystems({
    memory: {
      scheme: 'sqlite',
      retrieveTopK: 3,
    },
  })

  assert.equal(system?.name, 'memory:sqlite')
  assert.equal(system?.type, 'memory')
})

test('createSystems keeps memory noop disabled', () => {
  assert.deepEqual(createSystems({ memory: { scheme: 'noop' } }), [])
  assert.deepEqual(createSystems({ memory: {} }), [])
})

test('createSystems treats noop emotion configs as disabled', () => {
  assert.deepEqual(createSystems({ emotion: { scheme: 'noop' } }), [])
  assert.deepEqual(createSystems({ emotion: {} }), [])
})

test('createSystems treats noop relationship configs as disabled', () => {
  assert.deepEqual(createSystems({ relationship: { scheme: 'noop' } }), [])
  assert.deepEqual(createSystems({ relationship: {} }), [])
})

test('createSystems ignores legacy personality big-five configs', () => {
  assert.deepEqual(createSystems({
    personality: {
      scheme: 'big-five',
      big5: {
        openness: 0.9,
      },
      speechStyle: '冷静',
    },
  }), [])
})

test('createSystems instantiates multi-dim relationship system', () => {
  const [system] = createSystems({
    relationship: {
      scheme: 'multi-dim',
      baseline: {
        trust: 0.6,
        affinity: 0.55,
        familiarity: 0.2,
        respect: 0.75,
      },
    },
  })

  assert.equal(system?.name, 'relationship:multi-dim')
  assert.equal(system?.type, 'relationship')
})
