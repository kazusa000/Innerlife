'use client'

import { useEffect, useMemo, useState } from 'react'
import styles from './manager-ui.module.css'

export type PromptTestConfig = {
  testId: string
  defaultInput: unknown
}

type PromptTestPanelProps = PromptTestConfig & {
  agentId: string
  prompt: string
}

function stringifyInput(value: unknown) {
  return JSON.stringify(value, null, 2)
}

function readErrorMessage(value: unknown, fallback: string) {
  if (
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && 'error' in value
    && typeof value.error === 'string'
  ) {
    return value.error
  }
  return fallback
}

async function readResponseBody(response: Response) {
  const text = await response.text()
  if (!text.trim()) {
    return {
      error: response.ok
        ? '接口返回了空响应'
        : `接口返回了空错误响应（${response.status} ${response.statusText || 'Error'}）`,
    }
  }

  try {
    return JSON.parse(text) as unknown
  } catch {
    return {
      error: response.ok
        ? '接口返回了非 JSON 响应'
        : `接口返回了非 JSON 错误响应（${response.status} ${response.statusText || 'Error'}）`,
      rawText: text,
    }
  }
}

export const DEFAULT_PROMPT_TEST_INPUTS = {
  personalitySystem: {
    userMessage: '你还记得我喜欢什么游戏吗？',
  },
  personalityPersona: {
    userMessage: '我今天有点累，随便聊聊。',
  },
  personalityThinking: {
    userMessage: '帮我想一下怎么修这个记忆系统。',
  },
  memorySemantic: {
    recentMessages: [
      { role: 'user', text: '我最喜欢的游戏是星际2。' },
      { role: 'assistant', text: '我记住了。' },
    ],
    currentUserMessage: '那个游戏叫什么来着？',
  },
  memoryContextToShortTerm: {
    messages: [
      { role: 'user', text: '我最近又开始玩星际2了。' },
      { role: 'assistant', text: '你之前也提到过它。' },
      { role: 'user', text: '对，我想让你记住它是我喜欢的游戏。' },
    ],
  },
  memoryEntityMention: {
    currentUserMessage: '星际2和魔兽世界哪个更像我以前喜欢的游戏？',
  },
  memoryEpisodicExtraction: {
    memories: [
      {
        displaySummary: '用户说最喜欢的游戏从魔兽世界改成了星际2。',
        retrievalText: '用户最喜欢的游戏曾是魔兽世界，后来改成星际2。',
        importance: 0.82,
      },
      {
        displaySummary: '用户关心星际2和星际争霸2 alias 是否能合并。',
        retrievalText: '星际2是星际争霸2的简称，用户希望实体 alias 稳定。',
        importance: 0.76,
      },
    ],
  },
  memoryEntityResolution: {
    candidates: [
      {
        local_entity_id: 'local-game-1',
        surface: '星际2',
        type: 'object',
        context_hint: '用户提到的游戏简称',
        candidates: [
          {
            entity_id: 'entity-sc2',
            canonical_name: '星际争霸2',
            type: 'object',
            description: '用户喜欢的游戏',
            match_kind: 'alias',
          },
        ],
      },
    ],
  },
  memoryShortTermFragment: {
    memories: [
      {
        displaySummary: '用户刚刚提到星际2是喜欢的游戏。',
        retrievalText: '用户喜欢星际2。',
        importance: 0.7,
        observedStartAt: '2026-04-30T10:00:00.000Z',
        observedEndAt: '2026-04-30T10:05:00.000Z',
      },
    ],
  },
  memoryFixedFragment: {
    memories: [
      {
        displaySummary: '用户稳定偏好科幻即时战略游戏。',
        retrievalText: '用户喜欢科幻即时战略游戏。',
        importance: 0.8,
        createdAt: '2026-04-30T10:00:00.000Z',
      },
    ],
  },
  emotionFragment: {
    state: { mood: -0.15, energy: 0.45, stress: 0.65 },
  },
  emotionAnalysis: {
    state: { mood: 0.05, energy: 0.55, stress: 0.3 },
    userMessage: '我今天测了一堆 bug，有点烦。',
    assistantReply: '听起来你已经定位到问题了，我们可以一块把它拆小。',
  },
  relationshipFragment: {
    state: { trust: 0.64, affinity: 0.58, familiarity: 0.42, respect: 0.7 },
    counterpart: {
      name: 'WJJ',
      role: '用户',
      description: '正在构建虚拟人系统的人',
      note: '喜欢直接指出设计问题',
    },
  },
  relationshipAnalysis: {
    state: { trust: 0.64, affinity: 0.58, familiarity: 0.42, respect: 0.7 },
    counterpart: { name: 'WJJ' },
    userMessage: '这个 UI 太难用了，你自己看看。',
    assistantReply: '我会先看实际页面，再把布局压紧。',
  },
  toolDescription: (toolName: string) => ({
    toolName,
    userMessage: toolName === 'web_fetch'
      ? '帮我查一下这个网页的内容。'
      : '你还记得我之前说过的游戏吗？',
  }),
} as const

export default function PromptTestPanel({
  agentId,
  testId,
  defaultInput,
  prompt,
}: PromptTestPanelProps) {
  const fallbackInput = useMemo(() => stringifyInput(defaultInput), [defaultInput])
  const [inputText, setInputText] = useState(fallbackInput)
  const [outputText, setOutputText] = useState('')
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadSample() {
      setLoading(true)
      setError(null)
      try {
        const response = await fetch(`/api/agents/${agentId}/prompt-tests`, { cache: 'no-store' })
        const data = await readResponseBody(response) as {
          defaults?: Record<string, unknown>
          samples?: Record<string, unknown>
          error?: string
        }
        if (!response.ok) {
          throw new Error(readErrorMessage(data, '加载 prompt 测试样例失败'))
        }
        if (!cancelled) {
          setInputText(stringifyInput(data.samples?.[testId] ?? data.defaults?.[testId] ?? defaultInput))
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '加载 prompt 测试样例失败')
          setInputText(fallbackInput)
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void loadSample()
    return () => {
      cancelled = true
    }
  }, [agentId, defaultInput, fallbackInput, testId])

  function parseInput() {
    try {
      return { ok: true as const, value: JSON.parse(inputText) as unknown }
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : '输入必须是 JSON',
      }
    }
  }

  async function runTest() {
    const parsed = parseInput()
    if (!parsed.ok) {
      setError(`输入 JSON 无效：${parsed.error}`)
      return
    }

    setRunning(true)
    setError(null)
    try {
      const response = await fetch(`/api/agents/${agentId}/prompt-tests/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          testId,
          prompt,
          input: parsed.value,
        }),
      })
      const data = await readResponseBody(response)
      if (!response.ok) {
        throw new Error(readErrorMessage(data, '运行 prompt 测试失败'))
      }
      setOutputText(stringifyInput(data))
    } catch (err) {
      setError(err instanceof Error ? err.message : '运行 prompt 测试失败')
    } finally {
      setRunning(false)
    }
  }

  async function saveSample() {
    const parsed = parseInput()
    if (!parsed.ok) {
      setError(`输入 JSON 无效：${parsed.error}`)
      return
    }

    setSaving(true)
    setError(null)
    try {
      const response = await fetch(`/api/agents/${agentId}/prompt-tests`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          testId,
          input: parsed.value,
        }),
      })
      const data = await readResponseBody(response)
      if (!response.ok) {
        throw new Error(readErrorMessage(data, '保存 prompt 测试样例失败'))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存 prompt 测试样例失败')
    } finally {
      setSaving(false)
    }
  }

  async function resetSample() {
    setInputText(fallbackInput)
    setSaving(true)
    setError(null)
    try {
      const response = await fetch(`/api/agents/${agentId}/prompt-tests`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          testId,
          reset: true,
        }),
      })
      const data = await readResponseBody(response)
      if (!response.ok) {
        throw new Error(readErrorMessage(data, '重置 prompt 测试样例失败'))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '重置 prompt 测试样例失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={styles.promptTestPanel}>
      <div className={styles.promptTestHead}>
        <div>
          <span className={styles.promptTestTitle}>测试面板</span>
          <span className={styles.promptTestId}>{testId}</span>
        </div>
        <div className={styles.promptActions}>
          <button type="button" className={styles.subtleButton} onClick={() => void saveSample()} disabled={saving || loading}>
            {saving ? '保存中…' : '保存样例'}
          </button>
          <button type="button" className={styles.subtleButton} onClick={() => void resetSample()} disabled={saving || loading}>
            重置样例
          </button>
          <button type="button" className={styles.primaryButton} onClick={() => void runTest()} disabled={running || loading}>
            {running ? '运行中…' : '运行测试'}
          </button>
        </div>
      </div>
      <div className={styles.promptTestGrid}>
        <label className={styles.promptTestColumn}>
          <span className={styles.fieldLabel}>Input JSON</span>
          <textarea
            className={styles.promptTestTextarea}
            rows={10}
            value={inputText}
            onChange={(event) => setInputText(event.target.value)}
          />
        </label>
        <label className={styles.promptTestColumn}>
          <span className={styles.fieldLabel}>Output</span>
          <textarea
            className={styles.promptTestTextarea}
            rows={10}
            value={outputText}
            readOnly
            placeholder="运行后显示实际输出。"
          />
        </label>
      </div>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  )
}
