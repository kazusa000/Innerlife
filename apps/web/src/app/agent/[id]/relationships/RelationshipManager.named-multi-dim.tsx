'use client'

import { useEffect, useMemo, useState } from 'react'
import PromptLab from '../PromptLab'
import { DEFAULT_PROMPT_TEST_INPUTS } from '../PromptTestPanel'
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

type Counterpart = {
  id: string
  name: string
  avatarUrl: string | null
  role: string | null
  description: string | null
  note: string | null
}

type RelationshipHistoryEntry = {
  summary: string
  trigger: string | null
  delta: RelationshipBaseline
  createdAt: string
}

type NamedRelationshipResponse = {
  agentId: string
  scheme: 'named-multi-dim'
  baseline: RelationshipBaseline
  decayPerTurn: number | null
  analysisModel: string | null
  fragmentPrompt: string | null
  analysisPrompt: string | null
  fragmentPromptDefault: string
  fragmentPromptEffective: string
  analysisPromptDefault: string
  analysisPromptEffective: string
  counterparts: Counterpart[]
  selectedCounterpartId: string | null
  selectedCounterpart: Counterpart | null
  currentState: RelationshipBaseline | null
  history: RelationshipHistoryEntry[]
}

function extractRenderedPromptTail(value: string) {
  const lines = value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const lastLine = lines.at(-1) ?? ''
  return lastLine.startsWith('- ') ? lastLine.slice(2) : lastLine
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isNamedRelationshipResponse(value: unknown): value is NamedRelationshipResponse {
  return isRecord(value) && Array.isArray(value.counterparts)
}

function readErrorMessage(value: unknown, fallback: string) {
  if (isRecord(value) && typeof value.error === 'string') {
    return value.error
  }
  return fallback
}

export default function RelationshipManagerNamedMultiDim({ agentId }: RelationshipManagerProps) {
  const [baseline, setBaseline] = useState<RelationshipBaseline>({ ...DEFAULT_RELATIONSHIP_BASELINE })
  const [decayPerTurn, setDecayPerTurn] = useState('')
  const [analysisModel, setAnalysisModel] = useState('')
  const [fragmentPrompt, setFragmentPrompt] = useState('')
  const [analysisPrompt, setAnalysisPrompt] = useState('')
  const [counterparts, setCounterparts] = useState<Counterpart[]>([])
  const [selectedCounterpartId, setSelectedCounterpartId] = useState<string | null>(null)
  const [currentState, setCurrentState] = useState<RelationshipBaseline | null>(null)
  const [history, setHistory] = useState<RelationshipHistoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [newCounterpartName, setNewCounterpartName] = useState('')

  async function loadConfig(counterpartId?: string | null) {
    setLoading(true)
    setError(null)

    try {
      const url = new URL(`/api/agents/${agentId}/relationships/named-multi-dim`, window.location.origin)
      if (counterpartId) {
        url.searchParams.set('counterpartId', counterpartId)
      }
      const response = await fetch(url.toString(), { cache: 'no-store' })
      const data = await response.json() as unknown
      if (!response.ok) {
        throw new Error(readErrorMessage(data, '加载关系配置失败'))
      }
      if (!isNamedRelationshipResponse(data)) {
        throw new Error('加载关系配置失败')
      }

      setBaseline(data.baseline)
      setDecayPerTurn(typeof data.decayPerTurn === 'number' ? String(data.decayPerTurn) : '')
      setAnalysisModel(data.analysisModel ?? '')
      setFragmentPrompt(data.fragmentPrompt ?? extractRenderedPromptTail(data.fragmentPromptDefault))
      setAnalysisPrompt(data.analysisPrompt ?? data.analysisPromptDefault)
      setCounterparts(data.counterparts)
      setSelectedCounterpartId(data.selectedCounterpartId)
      setCurrentState(data.currentState)
      setHistory(data.history)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载关系配置失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadConfig()
  }, [agentId])

  const selectedCounterpart = useMemo(
    () => counterparts.find((item) => item.id === selectedCounterpartId) ?? null,
    [counterparts, selectedCounterpartId],
  )

  function updateSelectedCounterpart(patch: Partial<Counterpart>) {
    if (!selectedCounterpart) {
      return
    }
    setCounterparts((current) => current.map((item) => (
      item.id === selectedCounterpart.id ? { ...item, ...patch } : item
    )))
  }

  async function saveConfig() {
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const response = await fetch(`/api/agents/${agentId}/relationships/named-multi-dim`, {
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
      if (!isNamedRelationshipResponse(data)) {
        throw new Error('保存关系配置失败')
      }
      setNotice('named-multi-dim 配置已保存。')
      setBaseline(data.baseline)
      setDecayPerTurn(typeof data.decayPerTurn === 'number' ? String(data.decayPerTurn) : '')
      setAnalysisModel(data.analysisModel ?? '')
      setFragmentPrompt(data.fragmentPrompt ?? extractRenderedPromptTail(data.fragmentPromptDefault))
      setAnalysisPrompt(data.analysisPrompt ?? data.analysisPromptDefault)
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存关系配置失败')
    } finally {
      setSaving(false)
    }
  }

  async function createCounterpart() {
    if (!newCounterpartName.trim()) {
      return
    }
    setError(null)
    setNotice(null)
    try {
      const response = await fetch(`/api/agents/${agentId}/relationships/named-multi-dim/counterparts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newCounterpartName }),
      })
      const data = await response.json() as unknown
      if (!response.ok) {
        throw new Error(readErrorMessage(data, '创建关系对象失败'))
      }
      if (!isRecord(data) || !isRecord(data.counterpart)) {
        throw new Error('创建关系对象失败')
      }
      setNewCounterpartName('')
      await loadConfig(typeof data.counterpart.id === 'string' ? data.counterpart.id : null)
      setNotice('关系对象已创建。')
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建关系对象失败')
    }
  }

  async function saveSelectedCounterpartProfile() {
    if (!selectedCounterpart || !selectedCounterpart.name.trim()) {
      return
    }
    setError(null)
    setNotice(null)
    try {
      const response = await fetch(
        `/api/agents/${agentId}/relationships/named-multi-dim/counterparts/${selectedCounterpart.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: selectedCounterpart.name,
            avatarUrl: selectedCounterpart.avatarUrl,
            role: selectedCounterpart.role,
            description: selectedCounterpart.description,
            note: selectedCounterpart.note,
          }),
        },
      )
      const data = await response.json() as unknown
      if (!response.ok) {
        throw new Error(readErrorMessage(data, '重命名关系对象失败'))
      }
      await loadConfig(selectedCounterpart.id)
      setNotice('关系对象档案已保存。')
    } catch (err) {
      setError(err instanceof Error ? err.message : '重命名关系对象失败')
    }
  }

  async function deleteSelectedCounterpart() {
    if (!selectedCounterpart) {
      return
    }
    setError(null)
    setNotice(null)
    try {
      const response = await fetch(
        `/api/agents/${agentId}/relationships/named-multi-dim/counterparts/${selectedCounterpart.id}`,
        { method: 'DELETE' },
      )
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(readErrorMessage(data, '删除关系对象失败'))
      }
      await loadConfig()
      setNotice('关系对象已删除。')
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除关系对象失败')
    }
  }

  if (loading) {
    return <p className={styles.copy}>正在加载 named-multi-dim relationship 配置…</p>
  }

  if (error && counterparts.length === 0) {
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
          <h3 className={styles.title}>Named multi-dim</h3>
          <p className={styles.copy}>
            左侧手动维护关系对象，右侧调整这个 scheme 的 baseline、prompt 和当前选中对象的关系状态。
          </p>
        </div>
        <div className={styles.heroActions}>
          <span className={styles.statusPill}>scheme · named-multi-dim</span>
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

      <div className={styles.workspaceLayout}>
        <aside className={styles.sideNav}>
          <div className={styles.sideNavHead}>
            <p className={styles.panelLabel}>关系对象</p>
            <h4 className={styles.panelTitle}>Counterparts</h4>
          </div>
          <div className={styles.fieldStack}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>新增对象</span>
              <input
                className={styles.input}
                value={newCounterpartName}
                onChange={(event) => setNewCounterpartName(event.target.value)}
                placeholder="例如：张三"
              />
            </label>
            <button type="button" className={styles.secondaryButton} onClick={() => void createCounterpart()}>
              新增关系对象
            </button>
          </div>

          <div className={styles.sectionNavList}>
            {counterparts.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`${styles.sectionNavButton} ${selectedCounterpartId === item.id ? styles.sectionNavButtonActive : ''}`}
                onClick={() => {
                  setSelectedCounterpartId(item.id)
                  void loadConfig(item.id)
                }}
              >
                <span className={styles.sectionNavIndex}>对象</span>
                <span>{item.name}</span>
                {item.role && <span className={styles.sideNavMeta}>{item.role}</span>}
              </button>
            ))}
          </div>
        </aside>

        <div className={styles.workspaceMain}>
          <div className={styles.relationshipGrid}>
            <div className={styles.relationshipLeftStack}>
              <section className={`${styles.panel} ${styles.panelFrame}`}>
              <div className={styles.panelHead}>
                <div>
                  <p className={styles.panelLabel}>结构配置</p>
                  <h4 className={styles.panelTitle}>Baseline & Model</h4>
                </div>
                <span className={styles.panelPill}>对象独立演化</span>
              </div>

              <div className={styles.traitGrid}>
                {([
                  ['trust', '信任基线', '越高越容易把对方当成可信对象。'],
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
                        setBaseline((current) => ({
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
                agentId={agentId}
                fields={[
                  {
                    key: 'fragmentPrompt',
                    label: 'Fragment Prompt',
                    helper: '控制当前绑定对象的 trust / affinity / familiarity / respect 如何轻微渗入主对话语气。',
                    value: fragmentPrompt,
                    placeholder: '例如：让当前对象的关系状态轻微影响亲疏感和分寸，不要播报数值。清空后保存会继续使用系统默认片段。',
                    rows: 7,
                  },
                  {
                    key: 'analysisPrompt',
                    label: 'Analysis Prompt',
                    helper: '控制每轮关系分析如何读上下文、如何输出四维 delta。',
                    value: analysisPrompt,
                    placeholder: '例如：请判断这一轮对当前对象 trust/affinity/familiarity/respect 的变化，只输出 JSON。清空后保存会回退系统默认。',
                    rows: 8,
                  },
                ]}
                onChange={(key, value) => {
                  if (key === 'fragmentPrompt') setFragmentPrompt(value)
                  if (key === 'analysisPrompt') setAnalysisPrompt(value)
                }}
                tests={{
                  fragmentPrompt: {
                    testId: 'relationshipNamed.fragment',
                    defaultInput: DEFAULT_PROMPT_TEST_INPUTS.relationshipFragment,
                  },
                  analysisPrompt: {
                    testId: 'relationshipNamed.analysis',
                    defaultInput: DEFAULT_PROMPT_TEST_INPUTS.relationshipAnalysis,
                  },
                }}
              />
            </div>

            <section className={`${styles.panel} ${styles.dossierPanel}`}>
              <div className={styles.panelHead}>
                <div>
                  <p className={styles.panelLabel}>当前对象</p>
                  <h4 className={styles.panelTitle}>{selectedCounterpart?.name ?? '未选择对象'}</h4>
                </div>
                {selectedCounterpart && (
                  <span className={styles.panelPill}>ID · {selectedCounterpart.id.slice(0, 8)}</span>
                )}
              </div>

              {!selectedCounterpart ? (
                <div className={styles.emptyState}>
                  <h3>先创建一个关系对象</h3>
                  <p className={styles.emptyCopy}>这个 scheme 不再使用固定 default-user。先在左边建对象，再绑定到聊天 session。</p>
                </div>
              ) : (
                <>
                  <div className={styles.fieldStack}>
                    <div className={styles.profileHeader}>
                      <div
                        className={styles.profileAvatar}
                        style={selectedCounterpart.avatarUrl ? undefined : {
                          backgroundImage: `linear-gradient(135deg, hsl(${selectedCounterpart.id.length * 31 % 360} 68% 56%), hsl(${(selectedCounterpart.id.length * 31 + 58) % 360} 72% 50%))`,
                        }}
                      >
                        {selectedCounterpart.avatarUrl ? (
                          <img src={selectedCounterpart.avatarUrl} alt="" />
                        ) : (
                          selectedCounterpart.name.slice(0, 2).toUpperCase()
                        )}
                      </div>
                      <div>
                        <p className={styles.panelLabel}>对象档案</p>
                        <h4 className={styles.panelTitle}>{selectedCounterpart.role || '未设置关系角色'}</h4>
                      </div>
                    </div>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>对象名称</span>
                      <input
                        className={styles.input}
                        value={selectedCounterpart.name}
                        onChange={(event) => updateSelectedCounterpart({ name: event.target.value })}
                      />
                    </label>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>头像 URL</span>
                      <input
                        className={styles.input}
                        value={selectedCounterpart.avatarUrl ?? ''}
                        onChange={(event) => updateSelectedCounterpart({ avatarUrl: event.target.value })}
                        placeholder="https://example.com/avatar.png"
                      />
                    </label>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>关系角色</span>
                      <input
                        className={styles.input}
                        value={selectedCounterpart.role ?? ''}
                        onChange={(event) => updateSelectedCounterpart({ role: event.target.value })}
                        placeholder="朋友 / 恋人 / 家人 / 同事 / 观察者"
                      />
                    </label>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>对象描述</span>
                      <textarea
                        className={styles.textarea}
                        value={selectedCounterpart.description ?? ''}
                        onChange={(event) => updateSelectedCounterpart({ description: event.target.value })}
                        placeholder="这个人是谁，偏客观描述。"
                        rows={4}
                      />
                    </label>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>角色主观备注</span>
                      <textarea
                        className={styles.textarea}
                        value={selectedCounterpart.note ?? ''}
                        onChange={(event) => updateSelectedCounterpart({ note: event.target.value })}
                        placeholder="角色怎么看这个人，偏主观理解。"
                        rows={4}
                      />
                    </label>
                    <div className={styles.inlineActions}>
                      <button type="button" className={styles.secondaryButton} onClick={() => void saveSelectedCounterpartProfile()}>
                        保存对象档案
                      </button>
                      <button type="button" className={styles.secondaryButton} onClick={() => void deleteSelectedCounterpart()}>
                        删除对象
                      </button>
                    </div>
                  </div>

                  <div className={styles.metricGrid}>
                    {([
                      ['trust', '信任'],
                      ['affinity', '亲和'],
                      ['familiarity', '熟悉'],
                      ['respect', '尊重'],
                    ] as Array<[keyof RelationshipBaseline, string]>).map(([key, label]) => (
                      <div key={key} className={styles.metricCard}>
                        <span className={styles.metricLabel}>{label}</span>
                        <strong className={styles.metricValue}>
                          {currentState ? currentState[key].toFixed(2) : '—'}
                        </strong>
                      </div>
                    ))}
                  </div>

                  <div className={styles.historyList}>
                    {history.length === 0 ? (
                      <p className={styles.copy}>这个对象还没有关系 history。先在聊天页把某个 session 绑定到它，再聊几轮看看。</p>
                    ) : (
                      history.map((entry) => (
                        <article key={`${entry.createdAt}-${entry.summary}`} className={styles.historyCard}>
                          <div className={styles.historyHead}>
                            <strong>{entry.summary}</strong>
                            <span>{new Date(entry.createdAt).toLocaleString()}</span>
                          </div>
                          <p className={styles.historyTrigger}>{entry.trigger ?? '无 trigger'}</p>
                        </article>
                      ))
                    )}
                  </div>
                </>
              )}
            </section>

          </div>
        </div>
      </div>
    </section>
  )
}
