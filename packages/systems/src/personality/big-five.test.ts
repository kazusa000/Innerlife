import assert from 'node:assert/strict'
import test from 'node:test'
import { createSystems } from '../registry'
import type { TurnContext } from '../types'

test('big-five personality system injects a stable prompt fragment from module config', async () => {
  const [system] = createSystems({
    personality: {
      scheme: 'big-five',
      big5: {
        openness: 0.9,
        conscientiousness: 0.35,
        extraversion: 0.8,
        agreeableness: 0.75,
        neuroticism: 0.2,
      },
      speechStyle: '简洁、口语化、偶尔自嘲',
      background: '一位喜欢拆解问题第一性原理的前端工程师',
    },
  })

  assert.equal(system?.name, 'personality:big-five')

  const ctx: TurnContext = {
    agentId: 'agent-1',
    sessionId: 'session-1',
    userId: 'user-1',
    input: { raw: '你好', text: '你好', modality: 'text' as const },
    state: {},
    promptFragments: [],
    messages: [],
  }

  await system?.beforeLLM?.(ctx)

  assert.equal(ctx.promptFragments.length, 1)
  assert.equal(ctx.promptFragments[0]?.source, 'personality:big-five')
  assert.equal(ctx.promptFragments[0]?.priority, 10)
  assert.match(ctx.promptFragments[0]?.content ?? '', /开放性|openness/i)
  assert.match(ctx.promptFragments[0]?.content ?? '', /说话风格/)
  assert.match(ctx.promptFragments[0]?.content ?? '', /简洁、口语化、偶尔自嘲/)
  assert.match(ctx.promptFragments[0]?.content ?? '', /背景/)
  assert.match(ctx.promptFragments[0]?.content ?? '', /第一性原理/)
})
