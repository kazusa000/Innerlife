import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_BIG5,
  DEFAULT_EMOTION_BASELINE,
  DEFAULT_RELATIONSHIP_BASELINE,
  buildModules,
  getRelationshipFormState,
  stripManagedModules,
} from './persona-modules'

test('getRelationshipFormState reads multi-dim relationship config from modules', () => {
  const state = getRelationshipFormState({
    relationship: {
      scheme: 'multi-dim',
      baseline: {
        trust: 0.7,
        affinity: 0.6,
        familiarity: 0.4,
        respect: 0.8,
      },
      decayPerTurn: 0.15,
      analysisModel: 'relationship-fast-model',
    },
  }, false)

  assert.deepEqual(state, {
    enabled: true,
    baseline: {
      trust: 0.7,
      affinity: 0.6,
      familiarity: 0.4,
      respect: 0.8,
    },
    decayPerTurn: 0.15,
    analysisModel: 'relationship-fast-model',
  })
})

test('buildModules writes relationship multi-dim when enabled and noop when disabled', () => {
  const enabledModules = buildModules(
    {},
    {
      enabled: true,
      big5: { ...DEFAULT_BIG5 },
      speechStyle: '',
      background: '',
    },
    {
      enabled: false,
      baseline: { ...DEFAULT_EMOTION_BASELINE },
      decayPerTurn: undefined,
      analysisModel: null,
    },
    {
      enabled: true,
      baseline: { ...DEFAULT_RELATIONSHIP_BASELINE, trust: 0.65 },
      decayPerTurn: 0.12,
      analysisModel: 'relationship-fast-model',
    },
    {
      scheme: 'noop',
      summarizeModel: '',
    },
    [],
  )

  assert.deepEqual(enabledModules.relationship, {
    scheme: 'multi-dim',
    baseline: {
      trust: 0.65,
      affinity: 0.4,
      familiarity: 0.1,
      respect: 0.5,
    },
    decayPerTurn: 0.12,
    analysisModel: 'relationship-fast-model',
  })

  const disabledModules = buildModules(
    {},
    {
      enabled: true,
      big5: { ...DEFAULT_BIG5 },
      speechStyle: '',
      background: '',
    },
    {
      enabled: false,
      baseline: { ...DEFAULT_EMOTION_BASELINE },
      decayPerTurn: undefined,
      analysisModel: null,
    },
    {
      enabled: false,
      baseline: { ...DEFAULT_RELATIONSHIP_BASELINE },
      decayPerTurn: undefined,
      analysisModel: null,
    },
    {
      scheme: 'noop',
      summarizeModel: '',
    },
    [],
  )

  assert.deepEqual(disabledModules.relationship, { scheme: 'noop' })
})

test('stripManagedModules removes relationship from base modules', () => {
  assert.deepEqual(stripManagedModules({
    debug: { scheme: 'hello-world' },
    relationship: { scheme: 'multi-dim' },
    memory: { scheme: 'sqlite' },
  }), {
    debug: { scheme: 'hello-world' },
  })
})
