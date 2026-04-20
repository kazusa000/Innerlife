'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  DEFAULT_MODEL_BY_PROVIDER,
  buildModules,
  getEmotionFormState,
  getMemoryFormState,
  getPersonalityFormState,
  getRelationshipFormState,
  type EmotionScheme,
  type MemoryScheme,
  type PersonalityScheme,
  type RelationshipScheme,
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

function readAgentSchemes(modules: Record<string, unknown> | null) {
  return {
    personality: getPersonalityFormState(modules, 'noop').scheme,
    emotion: getEmotionFormState(modules, 'noop').scheme,
    relationship: getRelationshipFormState(modules, 'noop').scheme,
    memory: getMemoryFormState(modules).scheme,
  }
}

function formatSchemeLabel(value: string) {
  if (value === 'noop') return '关闭'
  if (value === 'big-five') return 'Big Five'
  if (value === 'dimensional') return 'Dimensional'
  if (value === 'multi-dim') return 'Multi-dim'
  if (value === 'sqlite') return 'SQLite'
  return value
}

export default function HomePage() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [provider, setProvider] = useState<'anthropic' | 'openrouter'>('anthropic')
  const [model, setModel] = useState<string>(DEFAULT_MODEL_BY_PROVIDER.anthropic)
  const [baseModules, setBaseModules] = useState<Record<string, unknown> | null>({})
  const [personalityScheme, setPersonalityScheme] = useState<PersonalityScheme>('big-five')
  const [emotionScheme, setEmotionScheme] = useState<EmotionScheme>('noop')
  const [relationshipScheme, setRelationshipScheme] = useState<RelationshipScheme>('noop')
  const [memoryScheme, setMemoryScheme] = useState<MemoryScheme>('noop')
  const router = useRouter()

  async function loadAgents() {
    const res = await fetch('/api/agents')
    const data = await res.json()
    setAgents(data.agents)
  }

  useEffect(() => {
    void loadAgents()
  }, [])

  function resetForm() {
    setShowForm(false)
    setEditingId(null)
    setName('')
    setDescription('')
    setProvider('anthropic')
    setModel(DEFAULT_MODEL_BY_PROVIDER.anthropic)
    setBaseModules({})
    setPersonalityScheme('big-five')
    setEmotionScheme('noop')
    setRelationshipScheme('noop')
    setMemoryScheme('noop')
  }

  function startEdit(agent: Agent) {
    const personality = getPersonalityFormState(agent.modules, 'big-five')
    const emotion = getEmotionFormState(agent.modules, 'noop')
    const relationship = getRelationshipFormState(agent.modules, 'noop')
    const memory = getMemoryFormState(agent.modules)

    setEditingId(agent.id)
    setName(agent.name)
    setDescription(agent.description ?? '')
    setProvider(agent.provider ?? 'anthropic')
    setModel(agent.model)
    setBaseModules(agent.modules ?? {})
    setPersonalityScheme(personality.scheme)
    setEmotionScheme(emotion.scheme)
    setRelationshipScheme(relationship.scheme)
    setMemoryScheme(memory.scheme)
    setShowForm(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return

    const modules = buildModules(
      baseModules,
      { scheme: personalityScheme },
      { scheme: emotionScheme },
      { scheme: relationshipScheme },
      { scheme: memoryScheme },
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
    await loadAgents()
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this persona and all of its conversations?')) return
    await fetch(`/api/agents/${id}`, { method: 'DELETE' })
    await loadAgents()
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

  function openManager(
    agentId: string,
    section: 'personality' | 'emotion' | 'relationships' | 'memory',
  ) {
    router.push(`/agent/${agentId}/${section}`)
  }

  return (
    <main className="home">
      <div className="home-wrap">
        <header className="home-head">
          <div>
            <p className="eyebrow">Your companions</p>
            <h1 className="home-title">Virtual Personas</h1>
            <p className="home-sub">
              首页现在只负责选择 provider / model 和各模块 scheme。具体参数都迁到对应管理系统里。
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
                  onChange={(event) => setName(event.target.value)}
                  placeholder="e.g. Hazel, Orion, Sage"
                  autoFocus
                />
              </label>

              <label className="field">
                <span className="field-label">Description</span>
                <input
                  className="input"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="A calm late-night listener who loves stargazing"
                />
              </label>

              <label className="field">
                <span className="field-label">Provider</span>
                <select
                  className="input"
                  value={provider}
                  onChange={(event) => {
                    const nextProvider = event.target.value as 'anthropic' | 'openrouter'
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
                  onChange={(event) => setModel(event.target.value)}
                  placeholder={
                    provider === 'openrouter'
                      ? 'e.g. anthropic/claude-sonnet-4.6, openai/gpt-5.2'
                      : 'e.g. claude-sonnet-4-6, claude-haiku-4-5-20251001'
                  }
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
                  <span className="field-label">模块 scheme</span>
                  <span className="placeholder-pill">values 已移除</span>
                </div>

                <article className="module-card">
                  <div className="module-head">
                    <div>
                      <p className="module-label">性格</p>
                      <h4 className="module-title">Personality scheme</h4>
                    </div>
                    <span className="module-pill">{formatSchemeLabel(personalityScheme)}</span>
                  </div>
                  <p className="module-copy">
                    这里只决定是否启用、以及使用哪个 personality scheme。Big Five 分数、说话风格和背景故事去性格管理页维护。
                  </p>
                  <label className="field">
                    <span className="field-label">Scheme</span>
                    <select
                      className="input"
                      value={personalityScheme}
                      onChange={(event) =>
                        setPersonalityScheme(event.target.value as PersonalityScheme)}
                    >
                      <option value="noop">noop</option>
                      <option value="big-five">big-five</option>
                    </select>
                  </label>
                </article>

                <article className="module-card">
                  <div className="module-head">
                    <div>
                      <p className="module-label">情绪</p>
                      <h4 className="module-title">Emotion scheme</h4>
                    </div>
                    <span className="module-pill">{formatSchemeLabel(emotionScheme)}</span>
                  </div>
                  <p className="module-copy">
                    情绪模块的 baseline、decay 和 analysis model 迁到情绪管理页，这里只保留启用与 scheme 选择。
                  </p>
                  <label className="field">
                    <span className="field-label">Scheme</span>
                    <select
                      className="input"
                      value={emotionScheme}
                      onChange={(event) =>
                        setEmotionScheme(event.target.value as EmotionScheme)}
                    >
                      <option value="noop">noop</option>
                      <option value="dimensional">dimensional</option>
                    </select>
                  </label>
                </article>

                <article className="module-card">
                  <div className="module-head">
                    <div>
                      <p className="module-label">关系</p>
                      <h4 className="module-title">Relationship scheme</h4>
                    </div>
                    <span className="module-pill">{formatSchemeLabel(relationshipScheme)}</span>
                  </div>
                  <p className="module-copy">
                    关系模块的 baseline、decay 和 analysis model 迁到关系管理页。这里仅负责打开/关闭以及选择 scheme。
                  </p>
                  <label className="field">
                    <span className="field-label">Scheme</span>
                    <select
                      className="input"
                      value={relationshipScheme}
                      onChange={(event) =>
                        setRelationshipScheme(event.target.value as RelationshipScheme)}
                    >
                      <option value="noop">noop</option>
                      <option value="multi-dim">multi-dim</option>
                    </select>
                  </label>
                </article>

                <article className="module-card">
                  <div className="module-head">
                    <div>
                      <p className="module-label">记忆</p>
                      <h4 className="module-title">Memory scheme</h4>
                    </div>
                    <span className="module-pill">{formatSchemeLabel(memoryScheme)}</span>
                  </div>
                  <p className="module-copy">
                    Memory model override 已迁到 `/agent/[id]/memory`。首页只选择当前记忆架构，进入统一入口后再管理具体系统。
                  </p>
                  <label className="field">
                    <span className="field-label">Scheme</span>
                    <select
                      className="input"
                      value={memoryScheme}
                      onChange={(event) =>
                        setMemoryScheme(event.target.value as MemoryScheme)}
                    >
                      <option value="noop">noop</option>
                      <option value="sqlite">sqlite</option>
                    </select>
                  </label>
                </article>

                <div className="module-note">
                  <strong>模块参数已迁移。</strong>
                  <span>
                    保存后请从 persona 卡片进入 Personality / Emotion / Relationship / Memory
                    管理页继续配置详细参数。
                  </span>
                </div>
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
          {agents.map((agent) => {
            const schemes = readAgentSchemes(agent.modules)

            return (
              <article key={agent.id} className="card persona">
                <div
                  className="avatar"
                  style={{ backgroundImage: gradientFor(agent.id) }}
                >
                  {initials(agent.name)}
                </div>

                <div className="persona-body">
                  <div className="persona-head">
                    <div>
                      <h3 className="persona-name">{agent.name}</h3>
                      <p className="persona-meta">
                        {agent.provider} · {MODEL_LABELS[agent.model] ?? agent.model}
                      </p>
                    </div>
                    <span className="model-pill">
                      {MODEL_LABELS[agent.model] ?? agent.model}
                    </span>
                  </div>

                  {agent.description && (
                    <p className="persona-desc">{agent.description}</p>
                  )}

                  <div className="scheme-pills">
                    <span className="scheme-pill">性格: {formatSchemeLabel(schemes.personality)}</span>
                    <span className="scheme-pill">情绪: {formatSchemeLabel(schemes.emotion)}</span>
                    <span className="scheme-pill">关系: {formatSchemeLabel(schemes.relationship)}</span>
                    <span className="scheme-pill">记忆: {formatSchemeLabel(schemes.memory)}</span>
                  </div>

                  <div className="persona-actions">
                    <button
                      className="btn btn-primary"
                      onClick={() => handleChat(agent.id)}
                    >
                      Chat
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

                  <div className="manager-actions">
                    <button className="btn btn-secondary" onClick={() => openManager(agent.id, 'personality')}>
                      Personality
                    </button>
                    <button className="btn btn-secondary" onClick={() => openManager(agent.id, 'emotion')}>
                      Emotion
                    </button>
                    <button className="btn btn-secondary" onClick={() => openManager(agent.id, 'relationships')}>
                      Relationship
                    </button>
                    <button className="btn btn-secondary" onClick={() => openManager(agent.id, 'memory')}>
                      Memory
                    </button>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      </div>

      <style jsx>{`
        .home {
          min-height: 100vh;
          padding: 64px 24px 96px;
        }
        .home-wrap {
          max-width: 1040px;
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
          background: linear-gradient(135deg, #f5f5f7 0%, #d9d9e0 55%, var(--indigo) 100%);
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
        }
        .home-sub {
          color: var(--fg-muted);
          font-size: 15px;
          margin-top: 10px;
          max-width: 52ch;
          line-height: 1.7;
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
          padding: 16px;
          background: rgba(255, 255, 255, 0.02);
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
          gap: 14px;
        }
        .modules-panel-head {
          grid-column: 1 / -1;
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
          background: linear-gradient(135deg, rgba(129, 140, 248, 0.08), rgba(255, 255, 255, 0.02)), rgba(255, 255, 255, 0.02);
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .module-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
        }
        .module-label {
          margin: 0 0 4px;
          font-size: 12px;
          color: var(--fg-subtle);
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .module-title {
          margin: 0;
          font-size: 18px;
          color: var(--fg);
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
          white-space: nowrap;
        }
        .module-copy {
          margin: 0;
          color: var(--fg-muted);
          font-size: 13px;
          line-height: 1.65;
        }
        .module-note {
          grid-column: 1 / -1;
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 18px;
          padding: 14px 16px;
          background: rgba(0, 0, 0, 0.18);
          display: flex;
          flex-direction: column;
          gap: 6px;
          color: var(--fg-muted);
          line-height: 1.65;
        }
        .module-note strong {
          color: var(--fg);
        }
        .form-actions {
          display: flex;
          gap: 8px;
          padding-top: 4px;
          flex-wrap: wrap;
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
          background: radial-gradient(circle at 30% 30%, var(--indigo-glow), transparent 60%), radial-gradient(circle at 70% 70%, var(--orange-soft), transparent 60%);
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
          grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
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
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.22);
          flex-shrink: 0;
        }
        .persona-body {
          min-width: 0;
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .persona-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
        }
        .persona-name {
          font-size: 22px;
          line-height: 1.1;
          font-family: var(--font-display);
          font-weight: 450;
          font-variation-settings: 'SOFT' 100, 'opsz' 28;
        }
        .persona-meta {
          margin-top: 6px;
          color: var(--fg-subtle);
          font-size: 12px;
          line-height: 1.5;
        }
        .model-pill {
          flex-shrink: 0;
          font-size: 11px;
          line-height: 1;
          padding: 8px 10px;
          border-radius: 999px;
          color: var(--fg-subtle);
          border: 1px solid var(--border);
          background: rgba(255, 255, 255, 0.04);
          max-width: 170px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .persona-desc {
          color: var(--fg-muted);
          line-height: 1.65;
          font-size: 14px;
        }
        .scheme-pills {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .scheme-pill {
          padding: 6px 10px;
          border-radius: 999px;
          border: 1px solid rgba(129, 140, 248, 0.22);
          background: rgba(129, 140, 248, 0.08);
          color: var(--fg);
          font-size: 11px;
          line-height: 1;
        }
        .persona-actions,
        .manager-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .btn-secondary {
          background: rgba(255, 255, 255, 0.04);
        }
        @media (max-width: 760px) {
          .modules-panel {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </main>
  )
}
