import assert from 'node:assert/strict'
import test from 'node:test'
import { buildCreateRunRequest, resolveInitialJudgeConfig } from './judge-config'

test('resolveInitialJudgeConfig mirrors source agent provider and model', () => {
  const config = resolveInitialJudgeConfig({
    provider: 'anthropic',
    model: 'claude-opus-4-6',
  })

  assert.deepEqual(config, {
    judgeProvider: 'anthropic',
    judgeModel: 'claude-opus-4-6',
  })
})

test('buildCreateRunRequest trims judge model and omits empty overrides', () => {
  assert.deepEqual(
    buildCreateRunRequest({
      sourceAgentId: 'agent-1',
      judgeProvider: 'openrouter',
      judgeModel: '  qwen/qwen3.5-flash-02-23  ',
    }),
    {
      sourceAgentId: 'agent-1',
      judgeProvider: 'openrouter',
      judgeModel: 'qwen/qwen3.5-flash-02-23',
    },
  )

  assert.deepEqual(
    buildCreateRunRequest({
      sourceAgentId: 'agent-1',
      judgeProvider: null,
      judgeModel: '   ',
    }),
    {
      sourceAgentId: 'agent-1',
    },
  )
})
