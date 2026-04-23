import assert from 'node:assert/strict'
import test from 'node:test'
import { AGENT_MANAGER_TILES } from './manager-tiles'

test('agent manager tiles route tools and turing to different sections', () => {
  const toolsTile = AGENT_MANAGER_TILES.find((tile) => tile.title === '工具')
  const turingTile = AGENT_MANAGER_TILES.find((tile) => tile.title === '图灵测试')

  assert.equal(toolsTile?.section, 'tools')
  assert.equal(turingTile?.section, 'turing')
  assert.notEqual(toolsTile?.section, turingTile?.section)
})
