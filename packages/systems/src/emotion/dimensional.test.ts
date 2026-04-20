import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getDb, getRawSqlite, emotionStateRepo } from '@mas/db'
import { DimensionalEmotionSystem } from './dimensional'
import type { TurnContext } from '../types'

const dir = mkdtempSync(join(tmpdir(), 'mas-emotion-'))
const dbPath = join(dir, 'emotion.db')

getDb(dbPath)
getRawSqlite().exec(`
  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    personality TEXT,
    skills TEXT,
    modules TEXT,
    status TEXT NOT NULL DEFAULT 'idle',
    model TEXT NOT NULL,
    config TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL REFERENCES agents(id),
    title TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
  );
  CREATE TABLE IF NOT EXISTS emotion_states (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL REFERENCES agents(id),
    session_id TEXT NOT NULL REFERENCES sessions(id),
    state TEXT NOT NULL,
    delta TEXT,
    trigger TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
  );
`)

after(() => {
  rmSync(dir, { recursive: true, force: true })
})

function seedAgentAndSession(agentId: string, sessionId: string) {
  getRawSqlite().exec('DELETE FROM emotion_states; DELETE FROM sessions; DELETE FROM agents;')
  getRawSqlite().prepare(`
    INSERT INTO agents (id, name, model, status)
    VALUES (?, 'Emotion Agent', 'claude-sonnet-4-6', 'idle')
  `).run(agentId)

  getRawSqlite().prepare(`
    INSERT INTO sessions (id, agent_id, title, status)
    VALUES (?, ?, 'Emotion Session', 'active')
  `).run(sessionId, agentId)
}

function createContext(agentId: string, sessionId: string, userText = '你今天看起来很累'): TurnContext {
  return {
    agentId,
    sessionId,
    userId: 'user-1',
    input: {
      raw: userText,
      text: userText,
      modality: 'text',
    },
    state: {},
    turnMetadata: {},
    promptFragments: [],
    messages: [
      { role: 'user', content: [{ type: 'text', text: userText }] },
    ],
    response: {
      content: [{ type: 'text', text: '我会尽量调整好自己的状态。' }],
      stopReason: 'end_turn',
      usage: {
        inputTokens: 12,
        outputTokens: 18,
      },
    },
  }
}

test('dimensional emotion loads baseline, injects a fragment, and persists the updated state', async () => {
  const agentId = 'agent-baseline'
  const sessionId = 'session-baseline'
  seedAgentAndSession(agentId, sessionId)

  const system = new DimensionalEmotionSystem({
    scheme: 'dimensional',
    baseline: {
      mood: 0.2,
      energy: 0.5,
      stress: 0.1,
    },
    decayPerTurn: 0.15,
  })

  const ctx = createContext(agentId, sessionId, '你怎么这么慢')

  await system.beforeTurn?.(ctx)
  assert.deepEqual(ctx.state.emotion, {
    mood: 0.2,
    energy: 0.5,
    stress: 0.1,
  })

  await system.beforeLLM?.(ctx)
  assert.equal(ctx.promptFragments[0]?.priority, 20)
  assert.match(ctx.promptFragments[0]?.content ?? '', /当前情绪/)

  await system.afterLLM?.(ctx)
  assert.equal(ctx.pendingEmotionAnalysis?.kind, 'dimensional')
  assert.match(ctx.pendingEmotionAnalysis?.systemPrompt ?? '', /只输出 JSON/)
  assert.match(
    JSON.stringify(ctx.pendingEmotionAnalysis?.messages ?? []),
    /分析这一轮已经完成的对话/,
  )
  assert.match(JSON.stringify(ctx.pendingEmotionAnalysis?.messages ?? []), /你怎么这么慢/)

  ctx.emotionAnalysis = {
    delta: {
      mood: -0.3,
      energy: -0.1,
      stress: 0.25,
    },
    trigger: '用户用了不耐烦的语气',
    rawResponse: '{"mood_delta":-0.3,"energy_delta":-0.1,"stress_delta":0.25}',
  }

  await system.afterTurn?.(ctx)

  const latest = emotionStateRepo.getLatestEmotionState(agentId, sessionId)
  assert.equal(Number(latest?.state.mood.toFixed(2)), -0.1)
  assert.equal(Number(latest?.state.energy.toFixed(2)), 0.4)
  assert.equal(Number(latest?.state.stress.toFixed(2)), 0.35)
  assert.deepEqual(latest?.delta, {
    mood: -0.3,
    energy: -0.1,
    stress: 0.25,
  })
  assert.equal(latest?.trigger, '用户用了不耐烦的语气')
})

test('dimensional emotion decays from the latest stored state and clips values into range', async () => {
  const agentId = 'agent-clipped'
  const sessionId = 'session-clipped'
  seedAgentAndSession(agentId, sessionId)

  emotionStateRepo.addEmotionState({
    agentId,
    sessionId,
    state: {
      mood: 0.9,
      energy: 0.95,
      stress: 0.9,
    },
    delta: null,
    trigger: null,
  })

  const system = new DimensionalEmotionSystem({
    scheme: 'dimensional',
    baseline: {
      mood: 0.2,
      energy: 0.5,
      stress: 0.1,
    },
    decayPerTurn: 0.25,
  })

  const ctx = createContext(agentId, sessionId, '今天做得很好')
  await system.beforeTurn?.(ctx)

  ctx.emotionAnalysis = {
    delta: {
      mood: 0.5,
      energy: 0.3,
      stress: -1,
    },
    trigger: '用户给了强烈正反馈',
    rawResponse: '{"mood_delta":0.5,"energy_delta":0.3,"stress_delta":-1}',
  }

  await system.afterTurn?.(ctx)

  const latest = emotionStateRepo.getLatestEmotionState(agentId, sessionId)
  assert.deepEqual(latest?.state, {
    mood: 1,
    energy: 1,
    stress: 0,
  })
})
