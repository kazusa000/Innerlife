import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { agentRepo, bootstrapAppDatabases, resetDb, resetMemoryDb } from '@mas/db'
import type { LLMRequest, LLMResponse } from '@mas/core'
import {
  getPromptTestSamples,
  runPromptTest,
  updatePromptTestSamples,
} from './handler'

function bootstrap(dbPath: string, memoryDbPath: string) {
  process.env.MAS_MEMORY_DB_PATH = memoryDbPath
  resetDb()
  resetMemoryDb()
  bootstrapAppDatabases({ dbPath, memoryDbPath })
}

test('prompt test samples are persisted in the agent modules without changing prompts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-prompt-tests-route-'))
  const dbPath = join(dir, 'data.db')
  const memoryDbPath = join(dir, 'memory.db')

  try {
    bootstrap(dbPath, memoryDbPath)
    const agent = agentRepo.createAgent({
      name: 'Prompty',
      model: 'claude-sonnet-4-6',
      modules: {
        memory: {
          scheme: 'sqlite',
          semanticAnalyzerPrompt: '真实语义 prompt',
        },
      },
    })!

    const saved = updatePromptTestSamples(agent.id, {
      testId: 'memory.semanticAnalyzer',
      input: {
        recentMessages: [
          { role: 'user', text: '我喜欢星际2。' },
          { role: 'assistant', text: '我记住了。' },
        ],
        currentUserMessage: '那个游戏叫什么？',
      },
    })
    assert.equal(saved.status, 200)
    const savedPayload = await saved.json()
    assert.equal(savedPayload.samples['memory.semanticAnalyzer'].currentUserMessage, '那个游戏叫什么？')

    const loaded = getPromptTestSamples(agent.id)
    assert.equal(loaded.status, 200)
    const loadedPayload = await loaded.json()
    assert.equal(loadedPayload.samples['memory.semanticAnalyzer'].currentUserMessage, '那个游戏叫什么？')

    const updated = agentRepo.getAgent(agent.id)!
    assert.equal((updated.modules?.memory as { semanticAnalyzerPrompt?: string }).semanticAnalyzerPrompt, '真实语义 prompt')
    assert.equal(
      ((updated.modules?.promptTests as { samples?: Record<string, unknown> }).samples?.['memory.semanticAnalyzer'] as { currentUserMessage?: string }).currentUserMessage,
      '那个游戏叫什么？',
    )
  } finally {
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('prompt test render mode returns the actual fragment without calling a provider', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-prompt-tests-route-'))
  const dbPath = join(dir, 'data.db')
  const memoryDbPath = join(dir, 'memory.db')

  try {
    bootstrap(dbPath, memoryDbPath)
    const agent = agentRepo.createAgent({
      name: 'Prompty',
      model: 'claude-sonnet-4-6',
      modules: {
        emotion: {
          scheme: 'dimensional',
        },
      },
    })!

    const response = await runPromptTest(agent.id, {
      testId: 'emotion.fragment',
      prompt: '让情绪轻微影响语气，但不要播报数值。',
      input: {
        state: { mood: -0.25, energy: 0.4, stress: 0.7 },
      },
    }, {
      sendMessage: async () => {
        throw new Error('provider should not be called for render tests')
      },
    })

    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.equal(payload.mode, 'render')
    assert.match(payload.renderedOutput, /当前情绪状态参考/)
    assert.match(payload.renderedOutput, /mood/)
    assert.match(payload.renderedOutput, /让情绪轻微影响语气/)
  } finally {
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('prompt test llm mode sends the sample input and parses entity mention output', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-prompt-tests-route-'))
  const dbPath = join(dir, 'data.db')
  const memoryDbPath = join(dir, 'memory.db')
  const requests: LLMRequest[] = []

  try {
    bootstrap(dbPath, memoryDbPath)
    const agent = agentRepo.createAgent({
      name: 'Prompty',
      model: 'agent-model',
      modules: {
        memory: {
          scheme: 'sqlite',
          summarizeModel: 'memory-model',
        },
      },
    })!

    const response = await runPromptTest(agent.id, {
      testId: 'memory.entityMention',
      prompt: '自定义实体 mention prompt',
      input: {
        currentUserMessage: '星际2和魔兽世界哪个更像我以前喜欢的游戏？',
      },
    }, {
      sendMessage: async (request) => {
        requests.push(request)
        return {
          content: [{
            type: 'text',
            text: '{"mentions":[{"surface":"星际2","type":"object","context_hint":"游戏简称","confidence":0.92}]}',
          }],
          stopReason: 'end_turn',
          usage: { inputTokens: 11, outputTokens: 7 },
        } satisfies LLMResponse
      },
    })

    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.equal(payload.mode, 'llm')
    assert.equal(payload.systemPrompt, '自定义实体 mention prompt')
    assert.equal(payload.model, 'memory-model')
    assert.equal(payload.usage.inputTokens, 11)
    assert.equal(payload.parsedOutput.mentions[0].surface, '星际2')
    assert.equal(requests.length, 1)
    assert.equal(requests[0]?.systemPrompt, '自定义实体 mention prompt')
    assert.match(JSON.stringify(requests[0]?.messages), /星际2和魔兽世界/)
  } finally {
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})
