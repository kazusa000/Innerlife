import assert from 'node:assert/strict'
import test from 'node:test'
import {
  countConfiguredHomeModules,
  resolveSelectedAgentId,
  type HomeAgentModuleState,
} from './home-view-model'

test('resolveSelectedAgentId keeps the current agent when it still exists', () => {
  assert.equal(
    resolveSelectedAgentId(
      [
        { id: 'hazel' },
        { id: 'orion' },
      ],
      'orion',
    ),
    'orion',
  )
})

test('resolveSelectedAgentId falls back to the first agent when current is missing', () => {
  assert.equal(
    resolveSelectedAgentId(
      [
        { id: 'hazel' },
        { id: 'orion' },
      ],
      'deleted',
    ),
    'hazel',
  )
})

test('resolveSelectedAgentId returns null for an empty roster', () => {
  assert.equal(resolveSelectedAgentId([], 'deleted'), null)
})

test('countConfiguredHomeModules counts persona and enabled schemes', () => {
  const modules: HomeAgentModuleState = {
    personaConfigured: true,
    emotion: 'dimensional',
    relationship: 'noop',
    memory: 'sqlite',
  }

  assert.equal(countConfiguredHomeModules(modules), 3)
})
