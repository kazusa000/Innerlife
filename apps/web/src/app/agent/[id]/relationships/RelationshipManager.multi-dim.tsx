'use client'

import { useEffect, useState } from 'react'
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

export default function RelationshipManagerMultiDim(
  { agentId }: RelationshipManagerProps,
) {
  const [baseline, setBaseline] = useState<RelationshipBaseline>({
    ...DEFAULT_RELATIONSHIP_BASELINE,
  })
  const [decayPerTurn, setDecayPerTurn] = useState('')
  const [analysisModel, setAnalysisModel] = useState('')
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
          throw new Error(readErrorMessage(data, 'Failed to load relationship config'))
        }
        if (!isRelationshipResponse(data)) {
          throw new Error('Failed to load relationship config')
        }

        if (!cancelled) {
          setBaseline(data.baseline)
          setDecayPerTurn(
            typeof data.decayPerTurn === 'number' ? String(data.decayPerTurn) : '',
          )
          setAnalysisModel(data.analysisModel ?? '')
          setCurrentState(data.currentState)
          setHistory(data.history)
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : 'Failed to load relationship config',
          )
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
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          baseline,
          ...(decayPerTurn.trim() ? { decayPerTurn: Number(decayPerTurn) } : {}),
          analysisModel: analysisModel.trim() || null,
        }),
      })
      const data = await response.json() as unknown
      if (!response.ok) {
        throw new Error(readErrorMessage(data, 'Failed to save relationship config'))
      }
      if (!isRelationshipResponse(data)) {
        throw new Error('Failed to save relationship config')
      }

      setBaseline(data.baseline)
      setDecayPerTurn(
        typeof data.decayPerTurn === 'number' ? String(data.decayPerTurn) : '',
      )
      setAnalysisModel(data.analysisModel ?? '')
      setCurrentState(data.currentState)
      setHistory(data.history)
      setNotice('Relationship 配置已保存。')
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to save relationship config',
      )
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <p className="manager-copy">正在加载 multi-dim relationship 配置…</p>
  }

  if (error) {
    return (
      <div className="manager-state">
        <h3>Relationship 加载失败</h3>
        <p>{error}</p>
      </div>
    )
  }

  return (
    <section className="manager">
      <div className="manager-head">
        <div>
          <p className="manager-label">Scheme</p>
          <h3 className="manager-title">Multi-dim</h3>
          <p className="manager-copy">
            编辑 baseline、每轮衰减和分析模型。下面同时展示当前 relationship state 和最近 history。
          </p>
        </div>
        <button
          type="button"
          className="manager-button"
          onClick={() => void saveConfig()}
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>

      {notice && <p className="manager-notice manager-notice-success">{notice}</p>}

      <div className="trait-grid">
        {([
          ['trust', '信任 baseline', '范围 0 到 1，越高越容易把用户当成可信对象。'],
          ['affinity', '亲和 baseline', '范围 0 到 1，越高越容易表现出亲近和温度。'],
          ['familiarity', '熟悉 baseline', '范围 0 到 1，越高越像已经认识一段时间。'],
          ['respect', '尊重 baseline', '范围 0 到 1，越高越容易维持郑重和分寸感。'],
        ] as Array<[keyof RelationshipBaseline, string, string]>).map(([key, label, hint]) => (
          <label key={key} className="trait-card">
            <div className="trait-head">
              <span className="trait-label">{label}</span>
              <span className="trait-value">{baseline[key].toFixed(2)}</span>
            </div>
            <p className="trait-hint">{hint}</p>
            <input
              className="trait-slider"
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

        <label className="field">
          <span className="field-label">每轮衰减</span>
          <input
            className="input"
            type="number"
            min="0"
            max="1"
            step="0.01"
            value={decayPerTurn}
            onChange={(event) => setDecayPerTurn(event.target.value)}
            placeholder="0.10"
          />
        </label>

        <label className="field field-wide">
          <span className="field-label">分析模型</span>
          <input
            className="input"
            value={analysisModel}
            onChange={(event) => setAnalysisModel(event.target.value)}
            placeholder="留空则回退主模型"
          />
        </label>
      </div>

      <div className="status-grid">
        <section className="panel">
          <div className="panel-head">
            <h4>当前关系</h4>
            <span className="panel-pill">{currentState ? 'live' : 'empty'}</span>
          </div>
          {currentState ? (
            <dl className="metric-list">
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
            <p className="panel-copy">还没有 relationship state。多聊几轮后这里会出现当前四维关系。</p>
          )}
        </section>

        <section className="panel">
          <div className="panel-head">
            <h4>最近历史</h4>
            <span className="panel-pill">{history.length}</span>
          </div>
          {history.length > 0 ? (
            <div className="history-list">
              {history.map((entry) => (
                <article key={`${entry.createdAt}-${entry.summary}`} className="history-item">
                  <div className="history-head">
                    <strong>{new Date(entry.createdAt).toLocaleString()}</strong>
                    <span>
                      Δ {entry.delta.trust.toFixed(2)} / {entry.delta.affinity.toFixed(2)} / {entry.delta.familiarity.toFixed(2)} / {entry.delta.respect.toFixed(2)}
                    </span>
                  </div>
                  <p className="history-copy">{entry.summary}</p>
                  {entry.trigger && <p className="history-trigger">{entry.trigger}</p>}
                </article>
              ))}
            </div>
          ) : (
            <p className="panel-copy">还没有 relationship history。</p>
          )}
        </section>
      </div>

      {error && <p className="manager-notice manager-notice-error">{error}</p>}

      <style jsx>{`
        .manager {
          display: flex;
          flex-direction: column;
          gap: 18px;
          width: 100%;
        }
        .manager-head {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 18px;
          flex-wrap: wrap;
        }
        .manager-label,
        .field-label {
          color: var(--fg-subtle);
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          display: inline-block;
          margin-bottom: 8px;
        }
        .manager-title {
          font-size: 28px;
          font-weight: 500;
          margin-bottom: 8px;
        }
        .manager-copy {
          color: var(--fg-muted);
          line-height: 1.7;
          max-width: 60ch;
        }
        .manager-button {
          border-radius: 999px;
          border: 1px solid rgba(34, 197, 94, 0.28);
          background: rgba(34, 197, 94, 0.16);
          color: var(--fg);
          padding: 10px 15px;
          cursor: pointer;
        }
        .manager-button:disabled {
          opacity: 0.6;
          cursor: wait;
        }
        .manager-notice {
          border-radius: 16px;
          padding: 12px 14px;
          background: rgba(255, 255, 255, 0.04);
          color: var(--fg-muted);
          line-height: 1.6;
        }
        .manager-notice-success {
          background: rgba(52, 211, 153, 0.12);
          color: #c8ffe5;
        }
        .manager-notice-error {
          background: rgba(248, 113, 113, 0.12);
          color: #ffd5d5;
        }
        .manager-state {
          border: 1px dashed var(--border);
          border-radius: 20px;
          padding: 18px;
          background: rgba(255, 255, 255, 0.03);
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .manager-state h3 {
          font-size: 18px;
          font-weight: 500;
        }
        .trait-grid,
        .status-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 14px;
        }
        .trait-card,
        .field,
        .panel {
          border-radius: 20px;
          padding: 16px;
          background: rgba(0, 0, 0, 0.18);
          border: 1px solid rgba(255, 255, 255, 0.06);
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .trait-head,
        .panel-head,
        .history-head {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: baseline;
        }
        .trait-label {
          font-weight: 500;
        }
        .trait-value {
          color: #d2ffe2;
          font-variant-numeric: tabular-nums;
        }
        .trait-hint,
        .panel-copy,
        .history-copy,
        .history-trigger {
          color: var(--fg-muted);
          line-height: 1.6;
          font-size: 14px;
        }
        .trait-slider {
          width: 100%;
        }
        .field-wide {
          grid-column: span 2;
        }
        .input {
          width: 100%;
          border-radius: 14px;
          border: 1px solid rgba(255, 255, 255, 0.12);
          background: rgba(255, 255, 255, 0.04);
          color: var(--fg);
          padding: 12px 14px;
          font: inherit;
        }
        .panel-pill {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: #d6ffe4;
        }
        .metric-list {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }
        .metric-list div {
          padding: 12px;
          border-radius: 14px;
          background: rgba(255, 255, 255, 0.04);
        }
        .metric-list dt {
          color: var(--fg-subtle);
          font-size: 12px;
          margin-bottom: 6px;
        }
        .metric-list dd {
          margin: 0;
          font-size: 18px;
          font-variant-numeric: tabular-nums;
        }
        .history-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .history-item {
          border-radius: 14px;
          padding: 12px;
          background: rgba(255, 255, 255, 0.04);
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        @media (max-width: 860px) {
          .trait-grid,
          .status-grid {
            grid-template-columns: 1fr;
          }
          .field-wide {
            grid-column: span 1;
          }
        }
      `}</style>
    </section>
  )
}
