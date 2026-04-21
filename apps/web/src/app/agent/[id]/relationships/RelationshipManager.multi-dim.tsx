'use client'

import { useEffect, useState } from 'react'
import PromptLab from '../PromptLab'
import styles from '../manager-ui.module.css'
import { DEFAULT_RELATIONSHIP_BASELINE, type RelationshipBaseline } from '@/app/persona-modules'

type RelationshipManagerProps = {
  agentId: string
  meta: {
    agentId: string
    scheme: string | null
    supportedSchemes: string[]
    configured: boolean
  }
}

type RelationshipHistoryEntry = {
  summary: string
  trigger: string | null
  delta: RelationshipBaseline
  createdAt: string
}

type RelationshipResponse = {
  agentId: string
  scheme: 'multi-dim'
  baseline: RelationshipBaseline
  decayPerTurn: number | null
  analysisModel: string | null
  fragmentPrompt: string | null
  analysisPrompt: string | null
  currentState: RelationshipBaseline | null
  history: RelationshipHistoryEntry[]
}

function isRelationshipResponse(value: unknown): value is RelationshipResponse {
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

export default function RelationshipManagerMultiDim({ agentId }: RelationshipManagerProps) {
  const [baseline, setBaseline] = useState<RelationshipBaseline>({
    ...DEFAULT_RELATIONSHIP_BASELINE,
  })
  const [decayPerTurn, setDecayPerTurn] = useState('')
  const [analysisModel, setAnalysisModel] = useState('')
  const [fragmentPrompt, setFragmentPrompt] = useState('')
  const [analysisPrompt, setAnalysisPrompt] = useState('')
  const [currentState, setCurrentState] = useState<RelationshipBaseline | null>(null)
  const [history, setHistory] = useState<RelationshipHistoryEntry[]>([])
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
        const response = await fetch(`/api/agents/${agentId}/relationships/multi-dim`, {
          cache: 'no-store',
        })
        const data = await response.json() as unknown
        if (!response.ok) {
          throw new Error(readErrorMessage(data, '加载关系配置失败'))
        }
        if (!isRelationshipResponse(data)) {
          throw new Error('加载关系配置失败')
        }

        if (!cancelled) {
          setBaseline(data.baseline)
          setDecayPerTurn(typeof data.decayPerTurn === 'number' ? String(data.decayPerTurn) : '')
          setAnalysisModel(data.analysisModel ?? '')
          setFragmentPrompt(data.fragmentPrompt ?? '')
          setAnalysisPrompt(data.analysisPrompt ?? '')
          setCurrentState(data.currentState)
          setHistory(data.history)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '加载关系配置失败')
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
  }, [agentId])

  async function saveConfig() {
    setSaving(true)
    setError(null)
    setNotice(null)

    try {
      const response = await fetch(`/api/agents/${agentId}/relationships/multi-dim`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseline,
          ...(decayPerTurn.trim() ? { decayPerTurn: Number(decayPerTurn) } : {}),
          analysisModel: analysisModel.trim() || null,
          fragmentPrompt: fragmentPrompt.trim() || null,
          analysisPrompt: analysisPrompt.trim() || null,
        }),
      })
      const data = await response.json() as unknown
      if (!response.ok) {
        throw new Error(readErrorMessage(data, '保存关系配置失败'))
      }
      if (!isRelationshipResponse(data)) {
        throw new Error('保存关系配置失败')
      }

      setBaseline(data.baseline)
      setDecayPerTurn(typeof data.decayPerTurn === 'number' ? String(data.decayPerTurn) : '')
      setAnalysisModel(data.analysisModel ?? '')
      setFragmentPrompt(data.fragmentPrompt ?? '')
      setAnalysisPrompt(data.analysisPrompt ?? '')
      setCurrentState(data.currentState)
      setHistory(data.history)
      setNotice('关系 baseline、模型和 prompt 已保存。')
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存关系配置失败')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <p className={styles.copy}>正在加载 multi-dim relationship 配置…</p>
  }

  if (error) {
    return (
      <div className={styles.emptyState}>
        <h3>关系配置加载失败</h3>
        <p className={styles.emptyCopy}>{error}</p>
      </div>
    )
  }

  return (
    <section className={styles.workspace}>
      <div className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>关系管理</p>
          <h3 className={styles.title}>Multi-dim</h3>
          <p className={styles.copy}>
            这页负责长期 baseline、分析模型和全部关系 prompt。
            当前运行中的关系状态与最近 history 会在下方单独展示，方便你一边调一边观察。
          </p>
        </div>
        <div className={styles.heroActions}>
          <span className={styles.statusPill}>scheme · multi-dim</span>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => void saveConfig()}
            disabled={saving}
          >
            {saving ? '保存中…' : '保存更改'}
          </button>
        </div>
      </div>

      {notice && <p className={styles.notice}>{notice}</p>}
      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.grid}>
        <section className={styles.panel}>
          <div className={styles.panelHead}>
            <div>
              <p className={styles.panelLabel}>结构配置</p>
              <h4 className={styles.panelTitle}>Baseline & Model</h4>
            </div>
            <span className={styles.panelPill}>4 维 + 模型</span>
          </div>

          <div className={styles.traitGrid}>
            {([
              ['trust', '信任基线', '越高越容易把用户当成可信对象。'],
              ['affinity', '亲和基线', '越高越容易表现出亲近和温度。'],
              ['familiarity', '熟悉基线', '越高越像已经认识一段时间。'],
              ['respect', '尊重基线', '越高越容易维持郑重和分寸感。'],
            ] as Array<[keyof RelationshipBaseline, string, string]>).map(([key, label, hint]) => (
              <label key={key} className={styles.traitCard}>
                <div className={styles.traitHead}>
                  <span className={styles.traitLabel}>{label}</span>
                  <span className={styles.traitValue}>{baseline[key].toFixed(2)}</span>
                </div>
                <p className={styles.traitHint}>{hint}</p>
                <input
                  className={styles.slider}
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={baseline[key]}
                  onChange={(event) =>
                    setBaseline(current => ({
                      ...current,
                      [key]: Number(event.target.value),
                    }))}
                />
              </label>
            ))}
          </div>

          <div className={styles.fieldGrid}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>每轮衰减</span>
              <input
                className={styles.input}
                type="number"
                min="0"
                max="1"
                step="0.01"
                value={decayPerTurn}
                onChange={(event) => setDecayPerTurn(event.target.value)}
                placeholder="0.10"
              />
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>分析模型</span>
              <input
                className={styles.input}
                value={analysisModel}
                onChange={(event) => setAnalysisModel(event.target.value)}
                placeholder="留空则回退主模型"
              />
            </label>
          </div>
        </section>

        <PromptLab
          fields={[
            {
              key: 'fragmentPrompt',
              label: 'Fragment Prompt',
              helper: '控制 trust / affinity / familiarity / respect 如何轻微渗入主对话语气。',
              value: fragmentPrompt,
              placeholder: '例如：让关系状态轻微影响亲疏感和分寸，不要播报数值。',
              rows: 7,
            },
            {
              key: 'analysisPrompt',
              label: 'Analysis Prompt',
              helper: '控制每轮关系分析如何读上下文、如何输出四维 delta。',
              value: analysisPrompt,
              placeholder: '例如：请判断这一轮对 trust/affinity/familiarity/respect 的变化，只输出 JSON。',
              rows: 10,
            },
          ]}
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
            <h4 className={styles.panelTitle}>当前关系</h4>
            <span className={styles.panelPill}>{currentState ? '运行中' : '空'}</span>
          </div>
          {currentState ? (
            <dl className={styles.metricList}>
              <div>
                <dt>信任</dt>
                <dd>{currentState.trust.toFixed(2)}</dd>
              </div>
              <div>
                <dt>亲和</dt>
                <dd>{currentState.affinity.toFixed(2)}</dd>
              </div>
              <div>
                <dt>熟悉</dt>
                <dd>{currentState.familiarity.toFixed(2)}</dd>
              </div>
              <div>
                <dt>尊重</dt>
                <dd>{currentState.respect.toFixed(2)}</dd>
              </div>
            </dl>
          ) : (
            <p className={styles.panelCopy}>还没有当前关系状态。多聊几轮后这里会出现当前四维关系。</p>
          )}
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHead}>
            <h4 className={styles.panelTitle}>最近历史</h4>
            <span className={styles.panelPill}>{history.length}</span>
          </div>
          {history.length > 0 ? (
            <div className={styles.historyList}>
              {history.map((entry) => (
                <article key={`${entry.createdAt}-${entry.summary}`} className={styles.historyItem}>
                  <div className={styles.historyHead}>
                    <strong>{new Date(entry.createdAt).toLocaleString()}</strong>
                    <span className={styles.statusText}>
                      Δ {entry.delta.trust.toFixed(2)} / {entry.delta.affinity.toFixed(2)} / {entry.delta.familiarity.toFixed(2)} / {entry.delta.respect.toFixed(2)}
                    </span>
                  </div>
                  <p className={styles.historyCopy}>{entry.summary}</p>
                  {entry.trigger && <p className={styles.historyTrigger}>{entry.trigger}</p>}
                </article>
              ))}
            </div>
          ) : (
            <p className={styles.panelCopy}>还没有关系历史记录。</p>
          )}
        </section>
      </div>
    </section>
  )
}
