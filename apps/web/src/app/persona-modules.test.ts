import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildModules,
  getEmotionFormState,
  getMemoryFormState,
  getPersonalityAvatarUrl,
  getRelationshipFormState,
} from './persona-modules'

test('scheme-only form helpers read current non-personality schemes from modules', () => {
  const modules = {
    personality: {
      systemPrompt: '保持真实',
      personaPrompt: '像熟人',
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

  assert.deepEqual(getEmotionFormState(modules, 'noop'), { scheme: 'dimensional' })
  assert.deepEqual(getRelationshipFormState(modules, 'noop'), { scheme: 'multi-dim' })
  assert.deepEqual(getMemoryFormState(modules), { scheme: 'sqlite' })
})

test('buildModules preserves existing personality prompts and detailed module settings', () => {
  const result = buildModules(
    {
      personality: {
        systemPrompt: '保持真实',
        personaPrompt: '像熟人',
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
    { scheme: 'dimensional' },
    { scheme: 'multi-dim' },
    { scheme: 'sqlite' },
  )

  assert.deepEqual(result, {
    personality: {
      systemPrompt: '保持真实',
      personaPrompt: '像熟人',
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

test('getPersonalityAvatarUrl reads trimmed avatar url from modules.personality', () => {
  assert.equal(
    getPersonalityAvatarUrl({
      personality: {
        avatarUrl: '  https://example.com/avatar.webp  ',
      },
    }),
    'https://example.com/avatar.webp',
  )
  assert.equal(getPersonalityAvatarUrl({ personality: { avatarUrl: '' } }), '')
  assert.equal(getPersonalityAvatarUrl({ personality: 'legacy' }), '')
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
  )

  assert.deepEqual(result, {
    debug: { scheme: 'hello-world' },
    emotion: { scheme: 'noop' },
    relationship: { scheme: 'noop' },
    memory: { scheme: 'noop' },
  })
})
