import assert from 'node:assert/strict'
import test from 'node:test'
import { buildAgentSystemPrompt, readPersonalityPrompts } from './chat-executor'

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

test('buildAgentSystemPrompt renders role label in English locale', () => {
  const prompt = buildAgentSystemPrompt({
    name: 'Amadeus',
    description: null,
    modules: {
      personality: {
        systemPrompt: '中文系统人格。',
        personaPrompt: '中文角色约束。',
        systemPromptByLocale: {
          'en-US': 'You are Amadeus.',
        },
        personaPromptByLocale: {
          'en-US': 'Speak like a close friend.',
        },
      },
    },
  }, 'No tools are available.', 'en-US')

  assert.match(prompt, /^You are Amadeus\./)
  assert.match(prompt, /Additional role constraints: Speak like a close friend\./)
  assert.doesNotMatch(prompt, /角色额外约束/)
  assert.doesNotMatch(prompt, /中文系统人格|中文角色约束/)
})

test('readPersonalityPrompts exposes editable thinking role immersion prompt without fallback', () => {
  assert.deepEqual(
    readPersonalityPrompts({
      personality: {
        thinkingRoleImmersionPrompt: '只在 think 中内心独白。',
        thinkingRoleImmersionPromptByLocale: {
          'en-US': 'Think silently in character.',
        },
      },
    }, 'zh-CN'),
    {
      systemPrompt: '',
      personaPrompt: '',
      thinkingRoleImmersionPrompt: '只在 think 中内心独白。',
    },
  )

  assert.deepEqual(
    readPersonalityPrompts({
      personality: {
        thinkingRoleImmersionPrompt: '只在 think 中内心独白。',
        thinkingRoleImmersionPromptByLocale: {
          'en-US': 'Think silently in character.',
        },
      },
    }, 'en-US'),
    {
      systemPrompt: '',
      personaPrompt: '',
      thinkingRoleImmersionPrompt: 'Think silently in character.',
    },
  )

  assert.deepEqual(readPersonalityPrompts(null), {
    systemPrompt: '',
    personaPrompt: '',
    thinkingRoleImmersionPrompt: '',
  })
})
