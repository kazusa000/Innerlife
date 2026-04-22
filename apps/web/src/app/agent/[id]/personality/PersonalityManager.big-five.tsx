'use client'

import { useEffect, useState } from 'react'
import styles from '../manager-ui.module.css'
import { DEFAULT_BIG5, type BigFiveKey, type BigFiveScores } from '@/app/persona-modules'

const BIG_FIVE_FIELDS: Array<{
  key: BigFiveKey
  label: string
  hint: string
}> = [
  { key: 'openness', label: '开放性', hint: '高一点更爱探索新角度、抽象问题和新鲜表达。' },
  { key: 'conscientiousness', label: '尽责性', hint: '高一点更讲条理、结构、计划和完成度。' },
  { key: 'extraversion', label: '外向性', hint: '高一点更主动、热络、愿意带动交流节奏。' },
  { key: 'agreeableness', label: '宜人性', hint: '高一点更温和、合作，也更照顾对方感受。' },
  { key: 'neuroticism', label: '神经质', hint: '高一点更敏感、更警惕，也更容易担心风险。' },
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

export default function PersonalityManagerBigFive({ agentId }: PersonalityManagerProps) {
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
          throw new Error(readErrorMessage(data, '加载 Big Five 性格配置失败'))
        }
        if (!isBigFiveResponse(data)) {
          throw new Error('加载 Big Five 性格配置失败')
        }

        if (!cancelled) {
          setBig5(data.big5)
          setSpeechStyle(data.speechStyle)
          setBackground(data.background)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '加载 Big Five 性格配置失败')
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          big5,
          speechStyle,
          background,
        }),
      })
      const data = await response.json() as unknown
      if (!response.ok) {
        throw new Error(readErrorMessage(data, '保存 Big Five 性格配置失败'))
      }
      if (!isBigFiveResponse(data)) {
        throw new Error('保存 Big Five 性格配置失败')
      }

      setBig5(data.big5)
      setSpeechStyle(data.speechStyle)
      setBackground(data.background)
      setNotice('Big Five 配置已保存。')
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存 Big Five 性格配置失败')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <p className={styles.copy}>正在加载 Big Five 配置…</p>
  }

  if (error) {
    return (
      <div className={styles.emptyState}>
        <h3>Big Five 配置加载失败</h3>
        <p className={styles.emptyCopy}>{error}</p>
      </div>
    )
  }

  return (
    <section className={styles.workspace}>
      <div className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>人格管理</p>
          <h3 className={styles.title}>Big Five</h3>
          <p className={styles.copy}>
            这里只维护真正属于性格模块的结构化设定。角色级 System Prompt 和角色 Prompt 已迁到首页 persona 编辑层。
          </p>
        </div>
        <div className={styles.heroActions}>
          <span className={styles.statusPill}>scheme · big-five</span>
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
              <h4 className={styles.panelTitle}>人格控制台</h4>
            </div>
            <span className={styles.panelPill}>5 维 + 2 文本</span>
          </div>
          <div className={styles.traitGrid}>
            {BIG_FIVE_FIELDS.map(({ key, label, hint }) => (
              <label key={key} className={styles.traitCard}>
                <div className={styles.traitHead}>
                  <span className={styles.traitLabel}>{label}</span>
                  <span className={styles.traitValue}>{big5[key].toFixed(2)}</span>
                </div>
                <p className={styles.traitHint}>{hint}</p>
                <input
                  className={styles.slider}
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
          </div>

          <div className={styles.fieldGrid}>
            <label className={styles.wideField}>
              <span className={styles.fieldLabel}>说话风格</span>
              <input
                className={styles.input}
                value={speechStyle}
                onChange={(event) => setSpeechStyle(event.target.value)}
                placeholder="简洁、口语化、偶尔自嘲"
              />
            </label>

            <label className={styles.wideField}>
              <span className={styles.fieldLabel}>背景故事</span>
              <textarea
                className={styles.textarea}
                rows={5}
                value={background}
                onChange={(event) => setBackground(event.target.value)}
                placeholder="一位喜欢拆解问题第一性原理的前端工程师"
              />
            </label>
          </div>
        </section>
      </div>
    </section>
  )
}
