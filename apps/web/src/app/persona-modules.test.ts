import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildAutoSystemPrompt,
  buildModules,
  getEmotionFormState,
  getMemoryFormState,
  getPersonalityFormState,
  getRelationshipFormState,
  readLegacyPersonaPrompt,
} from './persona-modules'

test('scheme-only form helpers read current schemes from modules', () => {
  const modules = {
    personality: {
      scheme: 'big-five',
      big5: { openness: 0.9 },
    },
    emotion: {
      scheme: 'dimensional',
      baseline: { mood: 0.2 },
    },
    relationship: {
      scheme: 'multi-dim',
      baseline: { trust: 0.7 },
    },
    memory: {
      scheme: 'sqlite',
      summarizeModel: 'memory-fast',
    },
  }

  assert.deepEqual(getPersonalityFormState(modules, 'big-five'), { scheme: 'big-five' })
  assert.deepEqual(getEmotionFormState(modules, 'noop'), { scheme: 'dimensional' })
  assert.deepEqual(getRelationshipFormState(modules, 'noop'), { scheme: 'multi-dim' })
  assert.deepEqual(getMemoryFormState(modules), { scheme: 'sqlite' })
})

test('buildModules preserves detailed module settings when scheme stays enabled', () => {
  const result = buildModules(
    {
      personality: {
        scheme: 'big-five',
        big5: { openness: 0.88 },
        speechStyle: '冷静',
        prompt: '旧的人格 prompt',
      },
      emotion: {
        scheme: 'dimensional',
        baseline: { mood: 0.2, energy: 0.6, stress: 0.1 },
        analysisModel: 'emotion-fast',
      },
      relationship: {
        scheme: 'multi-dim',
        baseline: { trust: 0.7, affinity: 0.6, familiarity: 0.4, respect: 0.8 },
        analysisModel: 'relationship-fast',
      },
      memory: {
        scheme: 'sqlite',
        summarizeModel: 'memory-fast',
      },
    },
    { scheme: 'big-five' },
    { scheme: 'dimensional' },
    { scheme: 'multi-dim' },
    { scheme: 'sqlite' },
  )

  assert.deepEqual(result, {
    personality: {
      scheme: 'big-five',
      big5: { openness: 0.88 },
      speechStyle: '冷静',
    },
    emotion: {
      scheme: 'dimensional',
      baseline: { mood: 0.2, energy: 0.6, stress: 0.1 },
      analysisModel: 'emotion-fast',
    },
    relationship: {
      scheme: 'multi-dim',
      baseline: { trust: 0.7, affinity: 0.6, familiarity: 0.4, respect: 0.8 },
      analysisModel: 'relationship-fast',
    },
    memory: {
      scheme: 'sqlite',
      summarizeModel: 'memory-fast',
    },
  })
})

test('buildModules removes values and writes noop markers when a scheme is disabled', () => {
  const result = buildModules(
    {
      debug: { scheme: 'hello-world' },
      values: { scheme: 'priority-list', priorities: ['A'] },
      relationship: { scheme: 'multi-dim', baseline: { trust: 0.7 } },
    },
    { scheme: 'noop' },
    { scheme: 'noop' },
    { scheme: 'noop' },
    { scheme: 'noop' },
  )

  assert.deepEqual(result, {
    debug: { scheme: 'hello-world' },
    personality: { scheme: 'noop' },
    emotion: { scheme: 'noop' },
    relationship: { scheme: 'noop' },
    memory: { scheme: 'noop' },
  })
})

test('buildAutoSystemPrompt derives the current effective system prompt from name and description', () => {
  assert.equal(
    buildAutoSystemPrompt('Hazel', 'A calm late-night listener'),
    'You are Hazel. A calm late-night listener.',
  )
  assert.equal(
    buildAutoSystemPrompt('Hazel', ''),
    'You are Hazel.',
  )
  assert.equal(
    buildAutoSystemPrompt('', ''),
    '',
  )
})

test('readLegacyPersonaPrompt reads old personality.prompt fallback when present', () => {
  assert.equal(
    readLegacyPersonaPrompt({
      personality: {
        scheme: 'big-five',
        prompt: '像熟人，少一点客服感。',
      },
    }),
    '像熟人，少一点客服感。',
  )
  assert.equal(
    readLegacyPersonaPrompt({
      personality: {
        scheme: 'big-five',
      },
    }),
    '',
  )
})
