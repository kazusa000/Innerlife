import assert from 'node:assert/strict'
import test from 'node:test'
import { getDefaultTools, toolsToDefinitions } from './registry'

test('getDefaultTools returns all built-in tools from the registry manifest', () => {
  const toolNames = getDefaultTools().map((tool) => tool.name).sort()

  assert.deepEqual(toolNames, ['search_long_term_memory', 'web_fetch'])
})

test('toolsToDefinitions reflects the default registry contents', () => {
  const definitions = toolsToDefinitions(getDefaultTools())

  assert.deepEqual(
    definitions.map((definition) => definition.name).sort(),
    ['search_long_term_memory', 'web_fetch'],
  )
})
