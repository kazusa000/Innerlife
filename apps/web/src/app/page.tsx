'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  DEFAULT_BIG5,
  DEFAULT_EMOTION_BASELINE,
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_RELATIONSHIP_BASELINE,
  buildModules,
  getEmotionFormState,
  getMemoryFormState,
  getPersonalityFormState,
  getRelationshipFormState,
  readValuePriorities,
  stripManagedModules,
  type BigFiveKey,
  type BigFiveScores,
  type EmotionBaseline,
  type RelationshipBaseline,
} from './persona-modules'

interface Agent {
  id: string
  name: string
  description: string | null
  provider: 'anthropic' | 'openrouter'
  model: string
  modules: Record<string, unknown> | null
  status: string
  createdAt: string
}

const MODEL_LABELS: Record<string, string> = {
  'claude-sonnet-4-6': 'Sonnet 4.6',
  'claude-haiku-4-5-20251001': 'Haiku 4.5',
  'claude-opus-4-6': 'Opus 4.6',
}

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

function gradientFor(seed: string) {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  const a = h % 360
  const b = (a + 40 + (h % 80)) % 360
  return `linear-gradient(135deg, hsl(${a} 70% 58%) 0%, hsl(${b} 75% 52%) 100%)`
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/)
  const s = parts.length >= 2 ? parts[0][0] + parts[1][0] : name.slice(0, 2)
  return s.toUpperCase()
}

export default function HomePage() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [provider, setProvider] = useState<'anthropic' | 'openrouter'>('anthropic')
  const [model, setModel] = useState<string>(DEFAULT_MODEL_BY_PROVIDER.anthropic)
  const [baseModules, setBaseModules] = useState<Record<string, unknown>>({})
  const [personalityEnabled, setPersonalityEnabled] = useState(true)
  const [big5, setBig5] = useState<BigFiveScores>({ ...DEFAULT_BIG5 })
  const [speechStyle, setSpeechStyle] = useState('')
  const [background, setBackground] = useState('')
  const [emotionEnabled, setEmotionEnabled] = useState(false)
  const [emotionBaseline, setEmotionBaseline] = useState<EmotionBaseline>({
    ...DEFAULT_EMOTION_BASELINE,
  })
  const [emotionDecayPerTurn, setEmotionDecayPerTurn] = useState<number | undefined>(undefined)
  const [emotionAnalysisModel, setEmotionAnalysisModel] = useState<string | null>(null)
  const [relationshipEnabled, setRelationshipEnabled] = useState(false)
  const [relationshipBaseline, setRelationshipBaseline] = useState<RelationshipBaseline>({
    ...DEFAULT_RELATIONSHIP_BASELINE,
  })
  const [relationshipDecayPerTurn, setRelationshipDecayPerTurn] = useState<number | undefined>(undefined)
  const [relationshipAnalysisModel, setRelationshipAnalysisModel] = useState<string | null>(null)
  const [memoryScheme, setMemoryScheme] = useState<'noop' | 'sqlite'>('noop')
  const [memorySummarizeModel, setMemorySummarizeModel] = useState('')
  const [valuePriorities, setValuePriorities] = useState<string[]>([])
  const router = useRouter()

  async function loadAgents() {
    const res = await fetch('/api/agents')
    const data = await res.json()
    setAgents(data.agents)
  }

  useEffect(() => {
    loadAgents()
  }, [])

  function resetForm() {
    setShowForm(false)
    setEditingId(null)
    setName('')
    setDescription('')
    setProvider('anthropic')
    setModel(DEFAULT_MODEL_BY_PROVIDER.anthropic)
    setBaseModules({})
    setPersonalityEnabled(true)
    setBig5({ ...DEFAULT_BIG5 })
    setSpeechStyle('')
    setBackground('')
    setEmotionEnabled(false)
    setEmotionBaseline({ ...DEFAULT_EMOTION_BASELINE })
    setEmotionDecayPerTurn(undefined)
    setEmotionAnalysisModel(null)
    setRelationshipEnabled(false)
    setRelationshipBaseline({ ...DEFAULT_RELATIONSHIP_BASELINE })
    setRelationshipDecayPerTurn(undefined)
    setRelationshipAnalysisModel(null)
    setMemoryScheme('noop')
    setMemorySummarizeModel('')
    setValuePriorities([])
  }

  function startEdit(agent: Agent) {
    const personality = getPersonalityFormState(agent.modules, false)
    const emotion = getEmotionFormState(agent.modules, false)
    const relationship = getRelationshipFormState(agent.modules, false)
    const memory = getMemoryFormState(agent.modules)

    setEditingId(agent.id)
    setName(agent.name)
    setDescription(agent.description ?? '')
    setProvider(agent.provider ?? 'anthropic')
    setModel(agent.model)
    setBaseModules(stripManagedModules(agent.modules))
    setPersonalityEnabled(personality.enabled)
    setBig5(personality.big5)
    setSpeechStyle(personality.speechStyle)
    setBackground(personality.background)
    setEmotionEnabled(emotion.enabled)
    setEmotionBaseline(emotion.baseline)
    setEmotionDecayPerTurn(emotion.decayPerTurn)
    setEmotionAnalysisModel(emotion.analysisModel ?? null)
    setRelationshipEnabled(relationship.enabled)
    setRelationshipBaseline(relationship.baseline)
    setRelationshipDecayPerTurn(relationship.decayPerTurn)
    setRelationshipAnalysisModel(relationship.analysisModel ?? null)
    setMemoryScheme(memory.scheme)
    setMemorySummarizeModel(memory.summarizeModel)
    setValuePriorities(readValuePriorities(agent.modules))
    setShowForm(true)
  }

  function updatePriority(index: number, value: string) {
    setValuePriorities((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? value : item)),
    )
  }

  function addPriority() {
    setValuePriorities((current) => [...current, ''])
  }

  function removePriority(index: number) {
    setValuePriorities((current) => current.filter((_, itemIndex) => itemIndex !== index))
  }

  function movePriority(index: number, direction: -1 | 1) {
    setValuePriorities((current) => {
      const targetIndex = index + direction
      if (targetIndex < 0 || targetIndex >= current.length) {
        return current
      }

      const next = [...current]
      ;[next[index], next[targetIndex]] = [next[targetIndex], next[index]]
      return next
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return

    const modules = buildModules(
      baseModules,
      { enabled: personalityEnabled, big5, speechStyle, background },
      {
        enabled: emotionEnabled,
        baseline: emotionBaseline,
        decayPerTurn: emotionDecayPerTurn,
        analysisModel: emotionAnalysisModel,
      },
      {
        enabled: relationshipEnabled,
        baseline: relationshipBaseline,
        decayPerTurn: relationshipDecayPerTurn,
        analysisModel: relationshipAnalysisModel,
      },
      {
        scheme: memoryScheme,
        summarizeModel: memorySummarizeModel,
      },
      valuePriorities,
    )

    if (editingId) {
      await fetch(`/api/agents/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, provider, model, modules }),
      })
    } else {
      await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, provider, model, modules }),
      })
    }
    resetForm()
    loadAgents()
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this persona and all of its conversations?')) return
    await fetch(`/api/agents/${id}`, { method: 'DELETE' })
    loadAgents()
  }

  async function handleChat(agentId: string) {
    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId }),
    })
    const data = await res.json()
    router.push(`/chat?agent=${agentId}&session=${data.session.id}`)
  }

  function handleMemory(agentId: string) {
    router.push(`/agent/${agentId}/memory`)
  }

  return (
    <main className="home">
      <div className="home-wrap">
        <header className="home-head">
          <div>
            <p className="eyebrow">Your companions</p>
            <h1 className="home-title">Virtual Personas</h1>
            <p className="home-sub">
              Design a presence. Give it a voice. Meet again.
            </p>
          </div>
          <button
            className="btn btn-primary"
            onClick={() => {
              resetForm()
              setShowForm(true)
            }}
          >
            <span style={{ fontSize: 16, lineHeight: 1 }}>+</span> New persona
          </button>
        </header>

        {showForm && (
          <form onSubmit={handleSubmit} className="card form">
            <h3 className="form-title">
              {editingId ? 'Edit persona' : 'Create a persona'}
            </h3>
            <div className="form-grid">
              <label className="field">
                <span className="field-label">Name</span>
                <input
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Hazel, Orion, Sage"
                  autoFocus
                />
              </label>
              <label className="field">
                <span className="field-label">Description</span>
                <input
                  className="input"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="A calm late-night listener who loves stargazing"
                />
              </label>
              <label className="field">
                <span className="field-label">Provider</span>
                <select
                  className="input"
                  value={provider}
                  onChange={(e) => {
                    const nextProvider = e.target.value as 'anthropic' | 'openrouter'
                    setProvider(nextProvider)
                    if (
                      !model.trim()
                      || model === DEFAULT_MODEL_BY_PROVIDER.anthropic
                      || model === DEFAULT_MODEL_BY_PROVIDER.openrouter
                    ) {
                      setModel(DEFAULT_MODEL_BY_PROVIDER[nextProvider])
                    }
                  }}
                >
                  <option value="anthropic">Anthropic</option>
                  <option value="openrouter">OpenRouter</option>
                </select>
              </label>
              <label className="field">
                <span className="field-label">Model</span>
                <input
                  className="input"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={provider === 'openrouter'
                    ? 'e.g. anthropic/claude-sonnet-4.6, openai/gpt-5.2'
                    : 'e.g. claude-sonnet-4-6, claude-haiku-4-5-20251001'}
                  list="model-suggestions"
                />
                <datalist id="model-suggestions">
                  <option value="claude-sonnet-4-6" />
                  <option value="claude-haiku-4-5-20251001" />
                  <option value="claude-opus-4-6" />
                  <option value="anthropic/claude-sonnet-4.6" />
                  <option value="openai/gpt-5.2" />
                  <option value="google/gemini-2.5-flash" />
                  <option value="deepseek/deepseek-chat-v3-0324" />
                </datalist>
              </label>

              <section className="modules-panel" aria-label="Modules configuration">
                <div className="modules-panel-head">
                  <span className="field-label">模块配置</span>
                  <span className="placeholder-pill">Personality · Emotion · Relationship · Memory · Values</span>
                </div>

                <section className="module-card" aria-label="Personality configuration">
                  <div className="module-card-head">
                    <div className="module-copy-wrap">
                      <div className="module-copy-top">
                        <span className="field-label">性格</span>
                        <span className="module-pill">Big Five</span>
                      </div>
                      <p className="module-copy">
                        把五维人格、说话风格和背景故事写进 system prompt。
                      </p>
                    </div>
                    <label
                      className={`module-toggle ${personalityEnabled ? 'is-active' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={personalityEnabled}
                        onChange={(e) => setPersonalityEnabled(e.target.checked)}
                      />
                      <span>{personalityEnabled ? '启用中' : '已关闭'}</span>
                    </label>
                  </div>

                  {personalityEnabled ? (
                    <div className="personality-grid">
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
                            onChange={(e) =>
                              setBig5((current) => ({
                                ...current,
                                [key]: Number(e.target.value),
                              }))}
                          />
                        </label>
                      ))}

                      <label className="field personality-field-wide">
                        <span className="field-label">说话风格</span>
                        <input
                          className="input"
                          value={speechStyle}
                          onChange={(e) => setSpeechStyle(e.target.value)}
                          placeholder="简洁、口语化、偶尔自嘲"
                        />
                      </label>

                      <label className="field personality-field-wide">
                        <span className="field-label">背景故事</span>
                        <textarea
                          className="input textarea"
                          rows={4}
                          value={background}
                          onChange={(e) => setBackground(e.target.value)}
                          placeholder="一位喜欢拆解问题第一性原理的前端工程师"
                        />
                      </label>
                    </div>
                  ) : (
                    <p className="module-copy">
                      关闭后会写入 `personality.noop`，聊天时不会注入额外性格段。
                    </p>
                  )}
                </section>

                <section className="module-card" aria-label="Emotion configuration">
                  <div className="module-card-head">
                    <div className="module-copy-wrap">
                      <div className="module-copy-top">
                        <span className="field-label">情绪</span>
                        <span className="module-pill">Dimensional</span>
                      </div>
                      <p className="module-copy">
                        维护当前心情、精力、压力基线。实时状态变化在 Observer 里查看。
                      </p>
                    </div>
                    <label
                      className={`module-toggle ${emotionEnabled ? 'is-active' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={emotionEnabled}
                        onChange={(e) => setEmotionEnabled(e.target.checked)}
                      />
                      <span>{emotionEnabled ? '启用中' : '已关闭'}</span>
                    </label>
                  </div>

                  {emotionEnabled ? (
                    <div className="personality-grid">
                      <label className="trait-card">
                        <div className="trait-head">
                          <span className="trait-label">心情 baseline</span>
                          <span className="trait-value">{emotionBaseline.mood.toFixed(2)}</span>
                        </div>
                        <p className="trait-hint">范围 -1 到 1，越高越偏积极。</p>
                        <input
                          className="trait-slider"
                          type="range"
                          min="-1"
                          max="1"
                          step="0.05"
                          value={emotionBaseline.mood}
                          onChange={(e) =>
                            setEmotionBaseline((current) => ({
                              ...current,
                              mood: Number(e.target.value),
                            }))}
                        />
                      </label>

                      <label className="trait-card">
                        <div className="trait-head">
                          <span className="trait-label">精力 baseline</span>
                          <span className="trait-value">{emotionBaseline.energy.toFixed(2)}</span>
                        </div>
                        <p className="trait-hint">范围 0 到 1，越高越有劲。</p>
                        <input
                          className="trait-slider"
                          type="range"
                          min="0"
                          max="1"
                          step="0.05"
                          value={emotionBaseline.energy}
                          onChange={(e) =>
                            setEmotionBaseline((current) => ({
                              ...current,
                              energy: Number(e.target.value),
                            }))}
                        />
                      </label>

                      <label className="trait-card">
                        <div className="trait-head">
                          <span className="trait-label">压力 baseline</span>
                          <span className="trait-value">{emotionBaseline.stress.toFixed(2)}</span>
                        </div>
                        <p className="trait-hint">范围 0 到 1，越高越紧绷。</p>
                        <input
                          className="trait-slider"
                          type="range"
                          min="0"
                          max="1"
                          step="0.05"
                          value={emotionBaseline.stress}
                          onChange={(e) =>
                            setEmotionBaseline((current) => ({
                              ...current,
                              stress: Number(e.target.value),
                            }))}
                        />
                      </label>
                    </div>
                  ) : (
                    <p className="module-copy">
                      关闭后会写入 `emotion.noop`，聊天时不会注入当前情绪，也不会记录状态轨迹。
                    </p>
                  )}
                </section>

                <section className="module-card" aria-label="Relationship configuration">
                  <div className="module-card-head">
                    <div className="module-copy-wrap">
                      <div className="module-copy-top">
                        <span className="field-label">关系</span>
                        <span className="module-pill">Multi-dim</span>
                      </div>
                      <p className="module-copy">
                        控制信任、亲和、熟悉和尊重基线。启用后，关系变化会在 Observer 里显示并写入关系状态。
                      </p>
                    </div>
                    <label
                      className={`module-toggle ${relationshipEnabled ? 'is-active' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={relationshipEnabled}
                        onChange={(e) => setRelationshipEnabled(e.target.checked)}
                      />
                      <span>{relationshipEnabled ? '启用中' : '已关闭'}</span>
                    </label>
                  </div>

                  {relationshipEnabled ? (
                    <div className="personality-grid">
                      <label className="trait-card">
                        <div className="trait-head">
                          <span className="trait-label">信任 baseline</span>
                          <span className="trait-value">{relationshipBaseline.trust.toFixed(2)}</span>
                        </div>
                        <p className="trait-hint">范围 0 到 1，越高越容易把用户当成可信对象。</p>
                        <input
                          className="trait-slider"
                          type="range"
                          min="0"
                          max="1"
                          step="0.05"
                          value={relationshipBaseline.trust}
                          onChange={(e) =>
                            setRelationshipBaseline((current) => ({
                              ...current,
                              trust: Number(e.target.value),
                            }))}
                        />
                      </label>

                      <label className="trait-card">
                        <div className="trait-head">
                          <span className="trait-label">亲和 baseline</span>
                          <span className="trait-value">{relationshipBaseline.affinity.toFixed(2)}</span>
                        </div>
                        <p className="trait-hint">范围 0 到 1，越高越容易表现出亲近和温度。</p>
                        <input
                          className="trait-slider"
                          type="range"
                          min="0"
                          max="1"
                          step="0.05"
                          value={relationshipBaseline.affinity}
                          onChange={(e) =>
                            setRelationshipBaseline((current) => ({
                              ...current,
                              affinity: Number(e.target.value),
                            }))}
                        />
                      </label>

                      <label className="trait-card">
                        <div className="trait-head">
                          <span className="trait-label">熟悉 baseline</span>
                          <span className="trait-value">{relationshipBaseline.familiarity.toFixed(2)}</span>
                        </div>
                        <p className="trait-hint">范围 0 到 1，越高越像已经认识一段时间。</p>
                        <input
                          className="trait-slider"
                          type="range"
                          min="0"
                          max="1"
                          step="0.05"
                          value={relationshipBaseline.familiarity}
                          onChange={(e) =>
                            setRelationshipBaseline((current) => ({
                              ...current,
                              familiarity: Number(e.target.value),
                            }))}
                        />
                      </label>

                      <label className="trait-card">
                        <div className="trait-head">
                          <span className="trait-label">尊重 baseline</span>
                          <span className="trait-value">{relationshipBaseline.respect.toFixed(2)}</span>
                        </div>
                        <p className="trait-hint">范围 0 到 1，越高越容易维持郑重和分寸感。</p>
                        <input
                          className="trait-slider"
                          type="range"
                          min="0"
                          max="1"
                          step="0.05"
                          value={relationshipBaseline.respect}
                          onChange={(e) =>
                            setRelationshipBaseline((current) => ({
                              ...current,
                              respect: Number(e.target.value),
                            }))}
                        />
                      </label>
                    </div>
                  ) : (
                    <p className="module-copy">
                      关闭后会写入 `relationship.noop`，聊天时不会注入当前关系，也不会记录关系轨迹。
                    </p>
                  )}
                </section>

                <section className="module-card" aria-label="Memory configuration">
                  <div className="module-card-head">
                    <div className="module-copy-wrap">
                      <div className="module-copy-top">
                        <span className="field-label">记忆</span>
                        <span className="module-pill">SQLite entry</span>
                      </div>
                      <p className="module-copy">
                        统一入口固定在 `/agent/[id]/memory`。这里只决定 memory scheme，具体管理界面由入口页分发。
                      </p>
                    </div>
                  </div>

                  <div className="personality-grid">
                    <label className="field">
                      <span className="field-label">Memory scheme</span>
                      <select
                        className="input"
                        value={memoryScheme}
                        onChange={(event) =>
                          setMemoryScheme(event.target.value === 'sqlite' ? 'sqlite' : 'noop')}
                      >
                        <option value="noop">noop</option>
                        <option value="sqlite">sqlite</option>
                      </select>
                    </label>

                    {memoryScheme === 'sqlite' ? (
                      <label className="field">
                        <span className="field-label">Memory model override</span>
                        <input
                          className="input"
                          value={memorySummarizeModel}
                          onChange={(event) => setMemorySummarizeModel(event.target.value)}
                          placeholder="留空则继承 persona model；用于 retrieve / summarize / consolidate"
                        />
                      </label>
                    ) : (
                      <p className="module-empty">
                        关闭后会写入 `memory.noop`，打开 `/agent/[id]/memory` 时会显示空状态。
                      </p>
                    )}
                  </div>
                </section>

                <section className="module-card" aria-label="Values configuration">
                  <div className="module-card-head">
                    <div className="module-copy-wrap">
                      <div className="module-copy-top">
                        <span className="field-label">价值观</span>
                        <span className="module-pill">Priority list</span>
                      </div>
                      <p className="module-copy">
                        按优先级排序。越靠前，冲突场景下注入 prompt 时权重越高。
                      </p>
                    </div>
                    <button type="button" className="module-add" onClick={addPriority}>
                      Add value
                    </button>
                  </div>

                  {valuePriorities.length === 0 ? (
                    <p className="module-empty">
                      未配置时不写入 `modules.values`，行为等同 noop。
                    </p>
                  ) : (
                    <div className="priority-list">
                      {valuePriorities.map((value, index) => (
                        <div key={index} className="priority-row">
                          <span className="priority-index">{index + 1}</span>
                          <input
                            className="input"
                            value={value}
                            onChange={(e) => updatePriority(index, e.target.value)}
                            placeholder="e.g. Honesty over being liked"
                          />
                          <div className="priority-actions">
                            <button
                              type="button"
                              className="priority-button"
                              onClick={() => movePriority(index, -1)}
                              disabled={index === 0}
                            >
                              Up
                            </button>
                            <button
                              type="button"
                              className="priority-button"
                              onClick={() => movePriority(index, 1)}
                              disabled={index === valuePriorities.length - 1}
                            >
                              Down
                            </button>
                            <button
                              type="button"
                              className="priority-button priority-button-danger"
                              onClick={() => removePriority(index)}
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </section>
            </div>
            <div className="form-actions">
              <button type="submit" className="btn btn-primary">
                {editingId ? 'Save changes' : 'Create persona'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={resetForm}>
                Cancel
              </button>
            </div>
          </form>
        )}

        {agents.length === 0 && !showForm && (
          <div className="empty">
            <div className="empty-glyph" aria-hidden />
            <p className="empty-title">No personas yet</p>
            <p className="empty-sub">
              Create your first companion to start a conversation.
            </p>
          </div>
        )}

        <div className="grid">
          {agents.map((agent) => (
            <article key={agent.id} className="card persona">
              <div
                className="avatar"
                style={{ backgroundImage: gradientFor(agent.id) }}
              >
                {initials(agent.name)}
              </div>
              <div className="persona-body">
                <div className="persona-head">
                  <h3 className="persona-name">{agent.name}</h3>
                  <span className="model-pill">
                    {MODEL_LABELS[agent.model] ?? agent.model}
                  </span>
                </div>
                {agent.description && (
                  <p className="persona-desc">{agent.description}</p>
                )}
                <div className="persona-actions">
                  <button
                    className="btn btn-primary"
                    onClick={() => handleChat(agent.id)}
                  >
                    Chat
                  </button>
                  <button className="btn" onClick={() => handleMemory(agent.id)}>
                    Memory
                  </button>
                  <button className="btn" onClick={() => startEdit(agent)}>
                    Edit
                  </button>
                  <button
                    className="btn btn-danger"
                    onClick={() => handleDelete(agent.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>

      <style jsx>{`
        .home {
          min-height: 100vh;
          padding: 64px 24px 96px;
        }
        .home-wrap {
          max-width: 960px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          gap: 32px;
        }
        .home-head {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          gap: 24px;
          flex-wrap: wrap;
        }
        .eyebrow {
          font-size: 11px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--fg-subtle);
          margin-bottom: 10px;
        }
        .home-title {
          font-family: var(--font-display);
          font-size: clamp(40px, 6vw, 64px);
          font-weight: 400;
          line-height: 1;
          letter-spacing: -0.03em;
          font-variation-settings: 'SOFT' 80, 'opsz' 72;
          background: linear-gradient(
            135deg,
            #f5f5f7 0%,
            #d9d9e0 55%,
            var(--indigo) 100%
          );
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
        }
        .home-sub {
          color: var(--fg-muted);
          font-size: 15px;
          margin-top: 10px;
          max-width: 42ch;
        }
        .form {
          padding: 24px;
          display: flex;
          flex-direction: column;
          gap: 18px;
        }
        .form-title {
          font-size: 20px;
          font-weight: 500;
          font-variation-settings: 'SOFT' 80, 'opsz' 24;
        }
        .form-grid {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .field {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .field-label {
          font-size: 12px;
          color: var(--fg-muted);
          font-weight: 500;
          letter-spacing: 0.02em;
        }
        .modules-panel {
          border: 1px dashed var(--border);
          border-radius: 18px;
          padding: 14px 16px;
          background: rgba(255, 255, 255, 0.02);
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .modules-panel-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
        }
        .placeholder-pill {
          font-size: 11px;
          line-height: 1;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--fg-subtle);
          border: 1px solid var(--border);
          border-radius: 999px;
          padding: 6px 10px;
          background: rgba(255, 255, 255, 0.03);
        }
        .module-card {
          border: 1px solid rgba(129, 140, 248, 0.18);
          border-radius: 22px;
          padding: 16px;
          background:
            linear-gradient(
              135deg,
              rgba(129, 140, 248, 0.08),
              rgba(255, 255, 255, 0.02)
            ),
            rgba(255, 255, 255, 0.02);
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .module-card-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          flex-wrap: wrap;
        }
        .module-copy-wrap {
          display: flex;
          flex-direction: column;
          gap: 8px;
          min-width: 0;
        }
        .module-copy-top {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }
        .module-pill {
          font-size: 11px;
          line-height: 1;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #d9ddff;
          border: 1px solid rgba(129, 140, 248, 0.28);
          border-radius: 999px;
          padding: 6px 10px;
          background: rgba(129, 140, 248, 0.14);
        }
        .module-copy {
          color: var(--fg-muted);
          font-size: 13px;
          line-height: 1.6;
          margin: 0;
          max-width: 60ch;
        }
        .module-toggle {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          border: 1px solid var(--border);
          border-radius: 999px;
          padding: 8px 12px;
          background: rgba(255, 255, 255, 0.04);
          color: var(--fg-subtle);
          cursor: pointer;
          transition: border-color var(--dur) var(--ease),
            background var(--dur) var(--ease),
            color var(--dur) var(--ease);
        }
        .module-toggle.is-active {
          border-color: rgba(129, 140, 248, 0.4);
          background: rgba(129, 140, 248, 0.16);
          color: var(--fg);
        }
        .module-toggle input {
          margin: 0;
          accent-color: var(--indigo);
        }
        .module-toggle span {
          font-size: 12px;
          font-weight: 500;
        }
        .personality-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 12px;
        }
        .trait-card {
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 18px;
          padding: 14px;
          background: rgba(0, 0, 0, 0.18);
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .trait-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }
        .trait-label {
          color: var(--fg);
          font-size: 14px;
          font-weight: 500;
        }
        .trait-value {
          color: #d9ddff;
          font-size: 12px;
          font-variant-numeric: tabular-nums;
        }
        .trait-hint {
          margin: 0;
          color: var(--fg-muted);
          font-size: 12px;
          line-height: 1.55;
        }
        .trait-slider {
          width: 100%;
          accent-color: var(--indigo);
        }
        .personality-field-wide {
          grid-column: 1 / -1;
        }
        .textarea {
          min-height: 112px;
          resize: vertical;
        }
        .module-add,
        .priority-button {
          border: 1px solid var(--border);
          background: rgba(255, 255, 255, 0.04);
          color: var(--fg);
          border-radius: 999px;
          padding: 7px 12px;
          font-size: 12px;
          cursor: pointer;
          transition: background 120ms ease, border-color 120ms ease;
        }
        .module-add:hover,
        .priority-button:hover:not(:disabled) {
          background: rgba(255, 255, 255, 0.08);
          border-color: rgba(255, 255, 255, 0.18);
        }
        .priority-button:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }
        .priority-button-danger {
          color: #ffb4b4;
        }
        .module-empty {
          margin: 0;
          color: var(--fg-muted);
          font-size: 13px;
          line-height: 1.6;
        }
        .priority-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .priority-row {
          display: grid;
          grid-template-columns: 30px minmax(0, 1fr) auto;
          gap: 10px;
          align-items: center;
        }
        .priority-index {
          width: 30px;
          height: 30px;
          border-radius: 999px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          font-weight: 600;
          color: var(--fg);
          background: rgba(99, 102, 241, 0.16);
          border: 1px solid rgba(99, 102, 241, 0.24);
        }
        .priority-actions {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          justify-content: flex-end;
        }
        .form-actions {
          display: flex;
          gap: 8px;
          padding-top: 4px;
        }
        @media (max-width: 760px) {
          .priority-row {
            grid-template-columns: 30px minmax(0, 1fr);
          }
          .priority-actions {
            grid-column: 1 / -1;
            justify-content: flex-start;
            padding-left: 40px;
          }
        }
        @media (max-width: 640px) {
          .module-card {
            padding: 14px;
          }
          .personality-grid {
            grid-template-columns: 1fr;
          }
          .form-actions {
            flex-wrap: wrap;
          }
        }

        .empty {
          padding: 72px 24px;
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          gap: 12px;
        }
        .empty-glyph {
          width: 72px;
          height: 72px;
          border-radius: 999px;
          background:
            radial-gradient(
              circle at 30% 30%,
              var(--indigo-glow),
              transparent 60%
            ),
            radial-gradient(
              circle at 70% 70%,
              var(--orange-soft),
              transparent 60%
            );
          border: 1px solid var(--border);
        }
        .empty-title {
          font-family: var(--font-display);
          font-size: 22px;
          color: var(--fg);
          font-variation-settings: 'SOFT' 100, 'opsz' 28;
        }
        .empty-sub {
          color: var(--fg-muted);
          font-size: 14px;
        }

        .grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
          gap: 16px;
        }
        .persona {
          padding: 20px;
          display: flex;
          gap: 16px;
          align-items: flex-start;
        }
        .avatar {
          width: 52px;
          height: 52px;
          border-radius: 16px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: var(--font-display);
          font-size: 18px;
          font-weight: 500;
          color: rgba(255, 255, 255, 0.95);
          flex-shrink: 0;
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.2),
            0 8px 20px -8px rgba(0, 0, 0, 0.5);
          letter-spacing: -0.02em;
        }
        .persona-body {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .persona-head {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }
        .persona-name {
          font-family: var(--font-display);
          font-size: 19px;
          font-weight: 500;
          font-variation-settings: 'SOFT' 80, 'opsz' 24;
          color: var(--fg);
        }
        .model-pill {
          font-size: 10.5px;
          font-weight: 500;
          padding: 2px 8px;
          border-radius: 999px;
          background: var(--bg-glass);
          border: 1px solid var(--border);
          color: var(--fg-muted);
          letter-spacing: 0.02em;
        }
        .persona-desc {
          color: var(--fg-muted);
          font-size: 13.5px;
          line-height: 1.5;
        }
        .persona-actions {
          display: flex;
          gap: 6px;
          margin-top: 4px;
          flex-wrap: wrap;
        }
        .persona-actions .btn {
          padding: 6px 12px;
          font-size: 12.5px;
        }
      `}</style>
    </main>
  )
}
