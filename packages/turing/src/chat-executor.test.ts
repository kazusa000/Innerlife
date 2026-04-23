import assert from 'node:assert/strict'
import test from 'node:test'
import { buildAgentSystemPrompt } from './chat-executor'

test('buildAgentSystemPrompt reads both persona prompts from modules.personality', () => {
  const prompt = buildAgentSystemPrompt({
    name: 'Hazel',
    description: '一位安静的夜聊者',
    modules: {
      personality: {
        systemPrompt: '你是真实存在的人，不要自称 AI。',
        personaPrompt: '像熟人，克制一点，少解释。',
      },
      memory: {
        scheme: 'sqlite',
      },
    },
  })

  assert.match(prompt, /^你是真实存在的人，不要自称 AI。/)
  assert.match(prompt, /角色额外约束：像熟人，克制一点，少解释。/)
  assert.doesNotMatch(prompt, /旧的人格 prompt/)
  assert.match(prompt, /当前这轮可用工具如下/)
  assert.match(prompt, /search_long_term_memory/)
  assert.match(prompt, /继续完成本轮回复/)
  assert.doesNotMatch(prompt, /web_fetch/)
})

test('buildAgentSystemPrompt falls back to agent identity copy when persona system prompt is absent', () => {
  const prompt = buildAgentSystemPrompt({
    name: 'Hazel',
    description: '一位安静的夜聊者',
    tools: {
      web_fetch: {
        enabled: true,
      },
    },
    modules: {
      personality: {
        personaPrompt: '像熟人，不要客服腔。',
      },
      memory: {
        scheme: 'noop',
      },
    },
  })

  assert.match(prompt, /^You are Hazel\. 一位安静的夜聊者\./)
  assert.match(prompt, /角色额外约束：像熟人，不要客服腔。/)
  assert.match(prompt, /web_fetch/)
  assert.doesNotMatch(prompt, /search_long_term_memory/)
  assert.doesNotMatch(prompt, /Big Five|开放性|legacy/)
})
