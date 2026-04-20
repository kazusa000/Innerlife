'use client'

import { useEffect, useState } from 'react'
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
  currentState: EmotionBaseline | null
  history: EmotionHistoryEntry[]
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

export default function EmotionManagerDimensional(
  { agentId }: EmotionManagerProps,
) {
  const [currentState, setCurrentState] = useState<EmotionBaseline>({ ...DEFAULT_EMOTION_BASELINE })
  const [decayPerTurn, setDecayPerTurn] = useState<string>('')
  const [analysisModel, setAnalysisModel] = useState('')
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
          throw new Error(readErrorMessage(data, '加载情绪配置失败'))
        }
        if (!isEmotionResponse(data)) {
          throw new Error('加载情绪配置失败')
        }

        if (!cancelled) {
          setDecayPerTurn(
            typeof data.decayPerTurn === 'number' ? String(data.decayPerTurn) : '',
          )
          setAnalysisModel(data.analysisModel ?? '')
          setCurrentState(data.currentState ?? data.baseline)
          setHistory(data.history)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '加载情绪配置失败')
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
      const response = await fetch(`/api/agents/${agentId}/emotion/dimensional`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          currentState,
          ...(decayPerTurn.trim() ? { decayPerTurn: Number(decayPerTurn) } : {}),
          analysisModel: analysisModel.trim() || null,
        }),
      })
      const data = await response.json() as unknown
      if (!response.ok) {
        throw new Error(readErrorMessage(data, '保存情绪配置失败'))
      }
      if (!isEmotionResponse(data)) {
        throw new Error('保存情绪配置失败')
      }

      setDecayPerTurn(
        typeof data.decayPerTurn === 'number' ? String(data.decayPerTurn) : '',
      )
      setAnalysisModel(data.analysisModel ?? '')
      setCurrentState(data.currentState ?? data.baseline)
      setHistory(data.history)
      setNotice('当前情绪已更新。')
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存情绪配置失败')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <p className="manager-copy">正在加载 dimensional emotion 配置…</p>
  }

  if (error) {
    return (
      <div className="manager-state">
        <h3>情绪配置加载失败</h3>
        <p>{error}</p>
      </div>
    )
  }

  return (
    <section className="manager">
      <div className="manager-head">
        <div>
          <p className="manager-label">方案</p>
          <h3 className="manager-title">Dimensional</h3>
          <p className="manager-copy">
            这里直接调整当前情绪。保存时会写入一条 `manual_override` 记录；每轮衰减和分析模型仍可在下面继续配置。
          </p>
        </div>
        <button
          type="button"
          className="manager-button"
          onClick={() => void saveConfig()}
          disabled={saving}
        >
          {saving ? '保存中…' : '保存更改'}
        </button>
      </div>

      {notice && <p className="manager-notice manager-notice-success">{notice}</p>}

      <div className="trait-grid">
        <label className="trait-card">
          <div className="trait-head">
            <span className="trait-label">当前心情</span>
            <span className="trait-value">{currentState.mood.toFixed(2)}</span>
          </div>
          <p className="trait-hint">范围 -1 到 1，越高越偏积极。</p>
          <input
            className="trait-slider"
            type="range"
            min="-1"
            max="1"
            step="0.05"
            value={currentState.mood}
            onChange={(event) =>
              setCurrentState(current => ({ ...current, mood: Number(event.target.value) }))}
          />
        </label>

        <label className="trait-card">
          <div className="trait-head">
            <span className="trait-label">当前精力</span>
            <span className="trait-value">{currentState.energy.toFixed(2)}</span>
          </div>
          <p className="trait-hint">范围 0 到 1，越高越有劲。</p>
          <input
            className="trait-slider"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={currentState.energy}
            onChange={(event) =>
              setCurrentState(current => ({ ...current, energy: Number(event.target.value) }))}
          />
        </label>

        <label className="trait-card">
          <div className="trait-head">
            <span className="trait-label">当前压力</span>
            <span className="trait-value">{currentState.stress.toFixed(2)}</span>
          </div>
          <p className="trait-hint">范围 0 到 1，越高越紧绷。</p>
          <input
            className="trait-slider"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={currentState.stress}
            onChange={(event) =>
              setCurrentState(current => ({ ...current, stress: Number(event.target.value) }))}
          />
        </label>

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
            placeholder="0.15"
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
            <h4>当前情绪说明</h4>
            <span className="panel-pill">手动</span>
          </div>
          <p className="panel-copy">
            上面的三个滑杆代表这个虚拟人现在的真实情绪。保存后会立刻成为新的运行时状态，而不是去修改长期基线。
          </p>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h4>最近历史</h4>
            <span className="panel-pill">{history.length}</span>
          </div>
          {history.length > 0 ? (
            <div className="history-list">
              {history.map((entry) => (
                <article key={entry.createdAt} className="history-item">
                  <div className="history-head">
                    <strong>{new Date(entry.createdAt).toLocaleString()}</strong>
                    <span>
                      Δ {entry.delta ? `${entry.delta.mood.toFixed(2)} / ${entry.delta.energy.toFixed(2)} / ${entry.delta.stress.toFixed(2)}` : '无'}
                    </span>
                  </div>
                  <p className="history-copy">
                    状态：心情 {entry.state.mood.toFixed(2)}，精力 {entry.state.energy.toFixed(2)}，压力 {entry.state.stress.toFixed(2)}
                  </p>
                  {entry.trigger && <p className="history-trigger">{entry.trigger}</p>}
                </article>
              ))}
            </div>
          ) : (
            <p className="panel-copy">还没有 emotion history。</p>
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
          border: 1px solid rgba(244, 114, 182, 0.28);
          background: rgba(244, 114, 182, 0.16);
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
          color: #ffd3eb;
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
          color: #ffd6ec;
        }
        .metric-list {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
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
          .metric-list {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </section>
  )
}
