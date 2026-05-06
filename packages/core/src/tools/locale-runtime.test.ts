import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveAgentTools } from './runtime'
import type { Tool } from './types'

const tools: Tool[] = [
  {
    name: 'web_fetch',
    description: '抓取网页并返回清洗后的正文文本。',
    inputSchema: { type: 'object', properties: {} },
    async call() {
      return { output: '' }
    },
  },
]

test('tool runtime renders English defaults for en-US locale', () => {
  const resolved = resolveAgentTools({
    tools,
    modules: null,
    config: { web_fetch: { enabled: true } },
    locale: 'en-US',
  })

  assert.match(resolved.catalog[0]?.defaultDescription ?? '', /Fetch a web page/i)
  assert.match(resolved.systemPrompt, /tools are available/i)
  assert.doesNotMatch(resolved.systemPrompt, /当前这轮|抓取网页/)
})
