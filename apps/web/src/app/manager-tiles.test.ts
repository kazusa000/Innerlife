import assert from 'node:assert/strict'
import test from 'node:test'
import { AGENT_MANAGER_TILES } from './manager-tiles'

test('agent manager tiles only expose active management sections', () => {
  const toolsTile = AGENT_MANAGER_TILES.find((tile) => tile.title === '工具')

  assert.equal(toolsTile?.section, 'tools')
  assert.equal(AGENT_MANAGER_TILES.length, 5)
})
