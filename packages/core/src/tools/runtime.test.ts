import assert from 'node:assert/strict'
import test from 'node:test'
import { getDefaultTools } from './registry'
import { resolveAgentTools } from './runtime'

test('resolveAgentTools enables long-term memory search by default for sqlite memory and keeps web fetch off', () => {
  const resolved = resolveAgentTools({
    tools: getDefaultTools(),
    modules: {
      memory: {
        scheme: 'sqlite',
      },
    },
  })

  const searchTool = resolved.catalog.find((tool) => tool.name === 'search_long_term_memory')
  const webFetchTool = resolved.catalog.find((tool) => tool.name === 'web_fetch')

  assert.equal(searchTool?.defaultEnabled, true)
  assert.equal(searchTool?.configuredEnabled, true)
  assert.equal(searchTool?.effectiveEnabled, true)
  assert.match(searchTool?.defaultDescription ?? '', /每轮最多调用一次/)

  assert.equal(webFetchTool?.defaultEnabled, false)
  assert.equal(webFetchTool?.configuredEnabled, false)
  assert.equal(webFetchTool?.effectiveEnabled, false)

  assert.deepEqual(
    resolved.effectiveTools.map((tool) => tool.name),
    ['search_long_term_memory'],
  )
  assert.match(resolved.systemPrompt, /search_long_term_memory/)
  assert.doesNotMatch(resolved.systemPrompt, /web_fetch/)
})

test('resolveAgentTools applies per-agent overrides and blocks long-term search when memory is not sqlite', () => {
  const resolved = resolveAgentTools({
    tools: getDefaultTools(),
    modules: {
      memory: {
        scheme: 'noop',
      },
    },
    config: {
      search_long_term_memory: {
        description: '只有在确实需要追溯旧互动时才查长期记忆。',
      },
      web_fetch: {
        enabled: true,
        description: '抓取网页正文，提炼出当前回答需要的关键信息。',
      },
    },
  })

  const searchTool = resolved.catalog.find((tool) => tool.name === 'search_long_term_memory')
  const webFetchTool = resolved.catalog.find((tool) => tool.name === 'web_fetch')

  assert.equal(searchTool?.configuredEnabled, true)
  assert.equal(searchTool?.effectiveEnabled, false)
  assert.equal(searchTool?.unavailableReason, '仅当记忆方案为 sqlite 时才可生效。')
  assert.equal(searchTool?.effectiveDescription, '只有在确实需要追溯旧互动时才查长期记忆。')

  assert.equal(webFetchTool?.configuredEnabled, true)
  assert.equal(webFetchTool?.effectiveEnabled, true)
  assert.equal(
    webFetchTool?.effectiveDescription,
    '抓取网页正文，提炼出当前回答需要的关键信息。',
  )

  assert.deepEqual(
    resolved.effectiveTools.map((tool) => tool.name),
    ['web_fetch'],
  )
  assert.match(resolved.systemPrompt, /web_fetch/)
  assert.doesNotMatch(resolved.systemPrompt, /search_long_term_memory/)
})
