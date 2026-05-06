'use client'

import { useEffect, useState } from 'react'
import { useAppLocale } from '@/app/use-app-locale'
import PromptLab from '../PromptLab'
import { DEFAULT_PROMPT_TEST_INPUTS } from '../PromptTestPanel'
import styles from '../manager-ui.module.css'
import { DEFAULT_EMOTION_BASELINE, type EmotionBaseline } from '@/app/persona-modules'

type EmotionManagerProps = {
  agentId: string
  meta: {
    agentId: string
    scheme: string | null
    supportedSchemes: string[]
    configured: boolean
  }
}

type EmotionHistoryEntry = {
  state: EmotionBaseline
  delta: EmotionBaseline | null
  trigger: string | null
  createdAt: string
}

type EmotionResponse = {
  agentId: string
  scheme: 'dimensional'
  baseline: EmotionBaseline
  decayPerTurn: number | null
  analysisModel: string | null
  fragmentPrompt: string | null
  analysisPrompt: string | null
  fragmentPromptDefault: string
  fragmentPromptEffective: string
  analysisPromptDefault: string
  analysisPromptEffective: string
  currentState: EmotionBaseline | null
  history: EmotionHistoryEntry[]
}

function extractRenderedPromptTail(value: string) {
  const lines = value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const lastLine = lines.at(-1) ?? ''
  return lastLine.startsWith('- ') ? lastLine.slice(2) : lastLine
}

function isEmotionResponse(value: unknown): value is EmotionResponse {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && 'baseline' in value
    && 'history' in value
}

function readErrorMessage(value: unknown, fallback: string) {
  if (
    value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && 'error' in value
    && typeof value.error === 'string'
  ) {
    return value.error
  }

  return fallback
}

export default function EmotionManagerDimensional({ agentId }: EmotionManagerProps) {
  const locale = useAppLocale()
  const [currentState, setCurrentState] = useState<EmotionBaseline>({ ...DEFAULT_EMOTION_BASELINE })
  const [decayPerTurn, setDecayPerTurn] = useState('')
  const [analysisModel, setAnalysisModel] = useState('')
  const [fragmentPrompt, setFragmentPrompt] = useState('')
  const [analysisPrompt, setAnalysisPrompt] = useState('')
  const [history, setHistory] = useState<EmotionHistoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadConfig() {
      setLoading(true)
      setError(null)

      try {
        const response = await fetch(`/api/agents/${agentId}/emotion/dimensional`, {
          cache: 'no-store',
        })
        const data = await response.json() as unknown
        if (!response.ok) {
          throw new Error(readErrorMessage(data, locale === 'en-US' ? 'Failed to load emotion settings' : '加载情绪配置失败'))
        }
        if (!isEmotionResponse(data)) {
          throw new Error(locale === 'en-US' ? 'Failed to load emotion settings' : '加载情绪配置失败')
        }

        if (!cancelled) {
          setDecayPerTurn(typeof data.decayPerTurn === 'number' ? String(data.decayPerTurn) : '')
          setAnalysisModel(data.analysisModel ?? '')
          setFragmentPrompt(data.fragmentPrompt ?? extractRenderedPromptTail(data.fragmentPromptDefault))
          setAnalysisPrompt(data.analysisPrompt ?? data.analysisPromptDefault)
          setCurrentState(data.currentState ?? data.baseline)
          setHistory(data.history)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : locale === 'en-US' ? 'Failed to load emotion settings' : '加载情绪配置失败')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void loadConfig()
    return () => {
      cancelled = true
    }
  }, [agentId, locale])

  async function saveConfig() {
    setSaving(true)
    setError(null)
    setNotice(null)

    try {
      const response = await fetch(`/api/agents/${agentId}/emotion/dimensional`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentState,
          ...(decayPerTurn.trim() ? { decayPerTurn: Number(decayPerTurn) } : {}),
          analysisModel: analysisModel.trim() || null,
          fragmentPrompt: fragmentPrompt.trim() || null,
          analysisPrompt: analysisPrompt.trim() || null,
        }),
      })
      const data = await response.json() as unknown
      if (!response.ok) {
        throw new Error(readErrorMessage(data, locale === 'en-US' ? 'Failed to save emotion settings' : '保存情绪配置失败'))
      }
      if (!isEmotionResponse(data)) {
        throw new Error(locale === 'en-US' ? 'Failed to save emotion settings' : '保存情绪配置失败')
      }

      setDecayPerTurn(typeof data.decayPerTurn === 'number' ? String(data.decayPerTurn) : '')
      setAnalysisModel(data.analysisModel ?? '')
      setFragmentPrompt(data.fragmentPrompt ?? extractRenderedPromptTail(data.fragmentPromptDefault))
      setAnalysisPrompt(data.analysisPrompt ?? data.analysisPromptDefault)
      setCurrentState(data.currentState ?? data.baseline)
      setHistory(data.history)
      setNotice(locale === 'en-US' ? 'Emotion state, model, and prompts saved.' : '情绪状态、模型和 prompt 已保存。')
    } catch (err) {
      setError(err instanceof Error ? err.message : locale === 'en-US' ? 'Failed to save emotion settings' : '保存情绪配置失败')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <p className={styles.copy}>{locale === 'en-US' ? 'Loading dimensional emotion settings...' : '正在加载 dimensional emotion 配置…'}</p>
  }

  if (error) {
    return (
      <div className={styles.emptyState}>
        <h3>{locale === 'en-US' ? 'Failed to Load Emotion Settings' : '情绪配置加载失败'}</h3>
        <p className={styles.emptyCopy}>{error}</p>
      </div>
    )
  }

  return (
    <section className={styles.workspace}>
      <div className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>{locale === 'en-US' ? 'Emotion Management' : '情绪管理'}</p>
          <h3 className={styles.title}>Dimensional</h3>
          <p className={styles.copy}>
            {locale === 'en-US'
              ? 'Current emotion is runtime state. Saving writes a `manual_override` record. This page also exposes the emotion fragment and analysis prompts so you can tune both expression and updates directly.'
              : '当前情绪是运行时状态，保存会写入一条 `manual_override` 记录。这页同时开放情绪片段和分析 prompt，便于你直接调“如何表达”和“如何更新”。'}
          </p>
        </div>
        <div className={styles.heroActions}>
          <span className={styles.statusPill}>scheme · dimensional</span>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => void saveConfig()}
            disabled={saving}
          >
            {saving ? (locale === 'en-US' ? 'Saving...' : '保存中…') : (locale === 'en-US' ? 'Save Changes' : '保存更改')}
          </button>
        </div>
      </div>

      {notice && <p className={styles.notice}>{notice}</p>}
      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.emotionTopGrid}>
        <section className={`${styles.panel} ${styles.emotionGaugePanel}`}>
          <div className={styles.panelHead}>
            <div>
              <p className={styles.panelLabel}>{locale === 'en-US' ? 'Runtime State' : '运行时状态'}</p>
              <h4 className={styles.panelTitle}>Current Emotion</h4>
            </div>
            <span className={styles.panelPill}>{locale === 'en-US' ? '3 axes + model' : '3 轴 + 模型'}</span>
          </div>

          <div className={styles.traitGrid}>
            <label className={styles.traitCard}>
              <div className={styles.traitHead}>
                <span className={styles.traitLabel}>{locale === 'en-US' ? 'Current mood' : '当前心情'}</span>
                <span className={styles.traitValue}>{currentState.mood.toFixed(2)}</span>
              </div>
              <p className={styles.traitHint}>{locale === 'en-US' ? 'Range -1 to 1. Higher means more positive.' : '范围 -1 到 1，越高越偏积极。'}</p>
              <input
                className={styles.slider}
                type="range"
                min="-1"
                max="1"
                step="0.05"
                value={currentState.mood}
                onChange={(event) =>
                  setCurrentState(current => ({ ...current, mood: Number(event.target.value) }))}
              />
            </label>

            <label className={styles.traitCard}>
              <div className={styles.traitHead}>
                <span className={styles.traitLabel}>{locale === 'en-US' ? 'Current energy' : '当前精力'}</span>
                <span className={styles.traitValue}>{currentState.energy.toFixed(2)}</span>
              </div>
              <p className={styles.traitHint}>{locale === 'en-US' ? 'Range 0 to 1. Higher means more energetic.' : '范围 0 到 1，越高越有劲。'}</p>
              <input
                className={styles.slider}
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={currentState.energy}
                onChange={(event) =>
                  setCurrentState(current => ({ ...current, energy: Number(event.target.value) }))}
              />
            </label>

            <label className={styles.traitCard}>
              <div className={styles.traitHead}>
                <span className={styles.traitLabel}>{locale === 'en-US' ? 'Current stress' : '当前压力'}</span>
                <span className={styles.traitValue}>{currentState.stress.toFixed(2)}</span>
              </div>
              <p className={styles.traitHint}>{locale === 'en-US' ? 'Range 0 to 1. Higher means more tense.' : '范围 0 到 1，越高越紧绷。'}</p>
              <input
                className={styles.slider}
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={currentState.stress}
                onChange={(event) =>
                  setCurrentState(current => ({ ...current, stress: Number(event.target.value) }))}
              />
            </label>
          </div>

          <div className={styles.fieldGrid}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>{locale === 'en-US' ? 'Decay per turn' : '每轮衰减'}</span>
              <input
                className={styles.input}
                type="number"
                min="0"
                max="1"
                step="0.01"
                value={decayPerTurn}
                onChange={(event) => setDecayPerTurn(event.target.value)}
                placeholder="0.15"
              />
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>{locale === 'en-US' ? 'Analysis model' : '分析模型'}</span>
              <input
                className={styles.input}
                value={analysisModel}
                onChange={(event) => setAnalysisModel(event.target.value)}
                placeholder={locale === 'en-US' ? 'Leave blank to fall back to the main model' : '留空则回退主模型'}
              />
            </label>
          </div>
        </section>

        <PromptLab
          agentId={agentId}
          fields={[
            {
              key: 'fragmentPrompt',
              label: 'Fragment Prompt',
              helper: locale === 'en-US'
                ? 'Controls how the current emotion fragment affects the main chat tone. This is where constraints like “subtle influence” or “do not announce state values” belong.'
                : '控制当前情绪片段如何影响主对话语气。这里适合写“轻微影响”“不要播报状态值”这类约束。',
              value: fragmentPrompt,
              placeholder: locale === 'en-US'
                ? 'For example: Let emotion subtly affect tone, but do not announce it like a system status. Clear and save to keep using the system default fragment.'
                : '例如：让情绪轻微渗进语气，但不要像系统播报。清空后保存会继续使用系统默认片段。',
              rows: 7,
            },
            {
              key: 'analysisPrompt',
              label: 'Analysis Prompt',
              helper: locale === 'en-US'
                ? 'Controls how each turn reads context and outputs emotion deltas.'
                : '控制每轮情绪分析怎么读上下文、怎么输出 delta。',
              value: analysisPrompt,
              placeholder: locale === 'en-US'
                ? 'For example: Analyze this turn’s mood/energy/stress changes and output JSON only. Clear and save to fall back to the system default.'
                : '例如：请分析这一轮对 mood/energy/stress 的变化，只输出 JSON。清空后保存会回退系统默认。',
              rows: 10,
            },
          ]}
          tests={{
            fragmentPrompt: {
              testId: 'emotion.fragment',
              defaultInput: DEFAULT_PROMPT_TEST_INPUTS.emotionFragment,
            },
            analysisPrompt: {
              testId: 'emotion.analysis',
              defaultInput: DEFAULT_PROMPT_TEST_INPUTS.emotionAnalysis,
            },
          }}
          onChange={(key, value) => {
            if (key === 'fragmentPrompt') {
              setFragmentPrompt(value)
            } else if (key === 'analysisPrompt') {
              setAnalysisPrompt(value)
            }
          }}
        />
      </div>

      <div className={styles.statusGrid}>
        <section className={styles.panel}>
          <div className={styles.panelHead}>
            <h4 className={styles.panelTitle}>{locale === 'en-US' ? 'Current State Notes' : '当前状态说明'}</h4>
            <span className={styles.panelPill}>manual_override</span>
          </div>
          <p className={styles.panelCopy}>
            {locale === 'en-US'
              ? 'This controls this persona’s real current emotion, not the long-term baseline. After saving, it immediately becomes the new runtime state.'
              : '这里调的是现在这位虚拟人的真实情绪，不是长期基线。保存后会立刻成为新的运行时状态。'}
          </p>
          <dl className={styles.metricList}>
            <div>
              <dt>{locale === 'en-US' ? 'Mood' : '心情 mood'}</dt>
              <dd>{currentState.mood.toFixed(2)}</dd>
            </div>
            <div>
              <dt>{locale === 'en-US' ? 'Energy' : '精力 energy'}</dt>
              <dd>{currentState.energy.toFixed(2)}</dd>
            </div>
            <div>
              <dt>{locale === 'en-US' ? 'Stress' : '压力 stress'}</dt>
              <dd>{currentState.stress.toFixed(2)}</dd>
            </div>
          </dl>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHead}>
            <h4 className={styles.panelTitle}>{locale === 'en-US' ? 'Recent History' : '最近历史'}</h4>
            <span className={styles.panelPill}>{history.length}</span>
          </div>
          {history.length > 0 ? (
            <div className={styles.historyList}>
              {history.map((entry) => (
                <article key={entry.createdAt} className={styles.historyItem}>
                  <div className={styles.historyHead}>
                    <strong>{new Date(entry.createdAt).toLocaleString()}</strong>
                    <span className={styles.statusText}>
                      Δ {entry.delta ? `${entry.delta.mood.toFixed(2)} / ${entry.delta.energy.toFixed(2)} / ${entry.delta.stress.toFixed(2)}` : (locale === 'en-US' ? 'None' : '无')}
                    </span>
                  </div>
                  <p className={styles.historyCopy}>
                    {locale === 'en-US'
                      ? `State: mood ${entry.state.mood.toFixed(2)}, energy ${entry.state.energy.toFixed(2)}, stress ${entry.state.stress.toFixed(2)}`
                      : `状态：心情 ${entry.state.mood.toFixed(2)}，精力 ${entry.state.energy.toFixed(2)}，压力 ${entry.state.stress.toFixed(2)}`}
                  </p>
                  {entry.trigger && <p className={styles.historyTrigger}>{entry.trigger}</p>}
                </article>
              ))}
            </div>
          ) : (
            <p className={styles.panelCopy}>{locale === 'en-US' ? 'No emotion history yet.' : '还没有 emotion history。'}</p>
          )}
        </section>
      </div>
    </section>
  )
}
