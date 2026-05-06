import assert from 'node:assert/strict'
import test from 'node:test'
import { buildAgentSystemPrompt, readPersonalityPrompts } from './chat-executor'

test('buildAgentSystemPrompt reads localized personality prompts from the chat executor module', () => {
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
    }, 'en-US'),
    {
      systemPrompt: '',
      personaPrompt: '',
      thinkingRoleImmersionPrompt: 'Think silently in character.',
    },
  )
})
