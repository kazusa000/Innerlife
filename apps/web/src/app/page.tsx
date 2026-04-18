'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

interface Agent {
  id: string
  name: string
  description: string | null
  model: string
  modules: Record<string, unknown> | null
  status: string
  createdAt: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readValuePriorities(modules: Record<string, unknown> | null | undefined) {
  if (!isRecord(modules)) {
    return []
  }

  const values = modules.values
  if (!isRecord(values) || !Array.isArray(values.priorities)) {
    return []
  }

  return values.priorities
    .filter((value): value is string => typeof value === 'string')
    .map(value => value.trim())
    .filter(Boolean)
}

function stripValuesModule(modules: Record<string, unknown> | null | undefined) {
  if (!isRecord(modules)) {
    return {}
  }

  const next = { ...modules }
  delete next.values
  return next
}

function buildModules(
  baseModules: Record<string, unknown>,
  valuePriorities: string[],
) {
  const priorities = valuePriorities.map(value => value.trim()).filter(Boolean)
  const next = { ...baseModules }

  if (priorities.length > 0) {
    next.values = {
      scheme: 'priority-list',
      priorities,
    }
  }

  return Object.keys(next).length > 0 ? next : null
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

export default function HomePage() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [model, setModel] = useState('claude-sonnet-4-6')
  const [baseModules, setBaseModules] = useState<Record<string, unknown>>({})
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
    setModel('claude-sonnet-4-6')
    setBaseModules({})
    setValuePriorities([])
  }

  function startEdit(agent: Agent) {
    setEditingId(agent.id)
    setName(agent.name)
    setDescription(agent.description ?? '')
    setModel(agent.model)
    setBaseModules(stripValuesModule(agent.modules))
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
    const modules = buildModules(baseModules, valuePriorities)

    if (editingId) {
      await fetch(`/api/agents/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, model, modules }),
      })
    } else {
      await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, model, modules }),
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
                <span className="field-label">Model</span>
                <select
                  className="input"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                >
                  <option value="claude-sonnet-4-6">Claude Sonnet 4.6</option>
                  <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5</option>
                  <option value="claude-opus-4-6">Claude Opus 4.6</option>
                </select>
              </label>
              <section className="modules-panel" aria-label="Modules configuration">
                <div className="modules-panel-head">
                  <span className="field-label">模块配置</span>
                  <span className="placeholder-pill">Values ready</span>
                </div>
                <div className="module-card">
                  <div className="module-card-head">
                    <div>
                      <p className="module-card-title">价值观</p>
                      <p className="module-card-text">
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
          gap: 12px;
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
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .module-card-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
        }
        .module-card-title {
          margin: 0;
          color: var(--fg);
          font-size: 14px;
          font-weight: 600;
        }
        .module-card-text {
          color: var(--fg-muted);
          font-size: 13px;
          line-height: 1.6;
          margin: 0;
          max-width: 60ch;
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
