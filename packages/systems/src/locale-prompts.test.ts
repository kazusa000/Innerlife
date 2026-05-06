import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildContextToShortTermPrompt,
  buildSemanticAnalyzerPrompt,
  resolveMemorySqliteConfig,
} from './memory/sqlite'

test('memory prompt builders render English defaults for en-US locale', () => {
  const semanticPrompt = buildSemanticAnalyzerPrompt(null, 'en-US')
  const contextPrompt = buildContextToShortTermPrompt(null, 3, 'en-US')

  assert.match(semanticPrompt, /semantic analyzer/i)
  assert.match(semanticPrompt, /Return strict JSON/i)
  assert.doesNotMatch(semanticPrompt, /你是|只输出|当前用户消息/)
  assert.match(contextPrompt, /short-term memories/i)
  assert.match(contextPrompt, /detail/i)
  assert.doesNotMatch(contextPrompt, /短期记忆|简体中文/)
})

test('legacy single prompt overrides only apply to zh-CN locale', () => {
  const zhConfig = resolveMemorySqliteConfig({
    scheme: 'sqlite',
    semanticAnalyzerPrompt: '中文语义 prompt',
    semanticAnalyzerPromptByLocale: { 'en-US': 'English semantic prompt' },
  }, 'zh-CN')
  const enConfig = resolveMemorySqliteConfig({
    scheme: 'sqlite',
    semanticAnalyzerPrompt: '中文语义 prompt',
    semanticAnalyzerPromptByLocale: { 'en-US': 'English semantic prompt' },
  }, 'en-US')

  assert.equal(zhConfig.semanticAnalyzerPrompt, '中文语义 prompt')
  assert.equal(enConfig.semanticAnalyzerPrompt, 'English semantic prompt')
})
