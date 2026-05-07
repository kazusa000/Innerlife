import assert from 'node:assert/strict'
import test from 'node:test'
import { createProvider, resolveProviderName } from './factory'

test('resolveProviderName accepts openai-compatible provider', () => {
  assert.equal(resolveProviderName('anthropic'), 'anthropic')
  assert.equal(resolveProviderName('openrouter'), 'openrouter')
  assert.equal(resolveProviderName('openai-compatible'), 'openai-compatible')
  assert.equal(resolveProviderName('unknown'), 'anthropic')
})

test('createProvider creates openai-compatible provider', () => {
  assert.equal(createProvider('openai-compatible').name, 'openai-compatible')
})
