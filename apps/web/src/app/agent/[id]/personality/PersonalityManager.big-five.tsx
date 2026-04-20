'use client'

import { useEffect, useState } from 'react'
import { DEFAULT_BIG5, type BigFiveKey, type BigFiveScores } from '@/app/persona-modules'

const BIG_FIVE_FIELDS: Array<{
  key: BigFiveKey
  label: string
  hint: string
}> = [
  {
    key: 'openness',
    label: '开放性',
    hint: '高一点更爱探索新角度、抽象问题和新鲜表达。',
  },
  {
    key: 'conscientiousness',
    label: '尽责性',
    hint: '高一点更讲条理、结构、计划和完成度。',
  },
  {
    key: 'extraversion',
    label: '外向性',
    hint: '高一点更主动、热络、愿意带动交流节奏。',
  },
  {
    key: 'agreeableness',
    label: '宜人性',
    hint: '高一点更温和、合作，也更照顾对方感受。',
  },
  {
    key: 'neuroticism',
    label: '神经质',
    hint: '高一点更敏感、更警惕，也更容易担心风险。',
  },
]

type PersonalityManagerProps = {
  agentId: string
  meta: {
    agentId: string
    scheme: string | null
    supportedSchemes: string[]
    configured: boolean
  }
}

type BigFiveResponse = {
  agentId: string
  scheme: 'big-five'
  big5: BigFiveScores
  speechStyle: string
  background: string
}

function isBigFiveResponse(value: unknown): value is BigFiveResponse {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && 'big5' in value
    && 'speechStyle' in value
    && 'background' in value
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

export default function PersonalityManagerBigFive(
  { agentId }: PersonalityManagerProps,
) {
  const [big5, setBig5] = useState<BigFiveScores>({ ...DEFAULT_BIG5 })
  const [speechStyle, setSpeechStyle] = useState('')
  const [background, setBackground] = useState('')
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
        const response = await fetch(`/api/agents/${agentId}/personality/big-five`, {
          cache: 'no-store',
        })
        const data = await response.json() as unknown
        if (!response.ok) {
          throw new Error(readErrorMessage(data, 'Failed to load big-five personality config'))
        }
        if (!isBigFiveResponse(data)) {
          throw new Error('Failed to load big-five personality config')
        }

        if (!cancelled) {
          setBig5(data.big5)
          setSpeechStyle(data.speechStyle)
          setBackground(data.background)
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : 'Failed to load big-five personality config',
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
      const response = await fetch(`/api/agents/${agentId}/personality/big-five`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          big5,
          speechStyle,
          background,
        }),
      })
      const data = await response.json() as unknown
      if (!response.ok) {
        throw new Error(readErrorMessage(data, 'Failed to save big-five personality config'))
      }
      if (!isBigFiveResponse(data)) {
        throw new Error('Failed to save big-five personality config')
      }

      setBig5(data.big5)
      setSpeechStyle(data.speechStyle)
      setBackground(data.background)
      setNotice('Big Five 配置已保存。')
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to save big-five personality config',
      )
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <p className="manager-copy">正在加载 big-five 配置…</p>
  }

  if (error) {
    return (
      <div className="manager-state">
        <h3>Big Five 加载失败</h3>
        <p>{error}</p>
      </div>
    )
  }

  return (
    <section className="manager">
      <div className="manager-head">
        <div>
          <p className="manager-label">Scheme</p>
          <h3 className="manager-title">Big Five</h3>
          <p className="manager-copy">
            编辑五维人格、说话风格和背景故事。保存后只会更新 `modules.personality`。
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
      {!notice && <p className="manager-notice">当前 personality scheme 已固定为 `big-five`。</p>}

      <div className="trait-grid">
        {BIG_FIVE_FIELDS.map(({ key, label, hint }) => (
          <label key={key} className="trait-card">
            <div className="trait-head">
              <span className="trait-label">{label}</span>
              <span className="trait-value">{big5[key].toFixed(2)}</span>
            </div>
            <p className="trait-hint">{hint}</p>
            <input
              className="trait-slider"
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={big5[key]}
              onChange={(event) =>
                setBig5(current => ({
                  ...current,
                  [key]: Number(event.target.value),
                }))}
            />
          </label>
        ))}

        <label className="field field-wide">
          <span className="field-label">说话风格</span>
          <input
            className="input"
            value={speechStyle}
            onChange={(event) => setSpeechStyle(event.target.value)}
            placeholder="简洁、口语化、偶尔自嘲"
          />
        </label>

        <label className="field field-wide">
          <span className="field-label">背景故事</span>
          <textarea
            className="input textarea"
            rows={5}
            value={background}
            onChange={(event) => setBackground(event.target.value)}
            placeholder="一位喜欢拆解问题第一性原理的前端工程师"
          />
        </label>
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
          border: 1px solid rgba(56, 189, 248, 0.28);
          background: rgba(56, 189, 248, 0.16);
          color: var(--fg);
          padding: 10px 15px;
          cursor: pointer;
          transition: transform 120ms ease, opacity 120ms ease;
        }
        .manager-button:disabled {
          opacity: 0.6;
          cursor: wait;
          transform: none;
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
        .trait-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 14px;
        }
        .trait-card,
        .field {
          border-radius: 20px;
          padding: 16px;
          background: rgba(0, 0, 0, 0.18);
          border: 1px solid rgba(255, 255, 255, 0.06);
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .trait-head {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: baseline;
        }
        .trait-label {
          font-weight: 500;
        }
        .trait-value {
          color: #c6f0ff;
          font-variant-numeric: tabular-nums;
        }
        .trait-hint {
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
        .textarea {
          resize: vertical;
          min-height: 140px;
        }
        @media (max-width: 860px) {
          .trait-grid {
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
