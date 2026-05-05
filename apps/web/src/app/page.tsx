'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  DEFAULT_MODEL_BY_PROVIDER,
  buildModules,
  getEmotionFormState,
  getMemoryFormState,
  getPersonalityAvatarUrl,
  getRelationshipFormState,
  type EmotionScheme,
  type MemoryScheme,
  type RelationshipScheme,
} from './persona-modules'
import { AGENT_MANAGER_TILES, type AgentManagerSection } from './manager-tiles'
import {
  countConfiguredHomeModules,
  resolveSelectedAgentId,
  type HomeAgentModuleState,
} from './home-view-model'

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

const MODULE_STATUS = [
  {
    key: 'persona',
    title: '人设',
    subtitle: 'Prompt 与角色档案',
    section: 'personality',
  },
  {
    key: 'emotion',
    title: '情绪',
    subtitle: '心境、能量、压力',
    section: 'emotion',
  },
  {
    key: 'relationship',
    title: '关系',
    subtitle: '信任、熟悉、亲近',
    section: 'relationships',
  },
  {
    key: 'memory',
    title: '记忆',
    subtitle: '检索、归档、上下文',
    section: 'memory',
  },
] as const satisfies readonly {
  key: keyof HomeAgentModuleState | 'persona'
  title: string
  subtitle: string
  section: AgentManagerSection
}[]

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readAgentSchemes(modules: Record<string, unknown> | null): HomeAgentModuleState {
  const personality = isRecord(modules?.personality)
    ? modules?.personality as Record<string, unknown>
    : null
  const personaConfigured =
    (typeof personality?.systemPrompt === 'string' && personality.systemPrompt.trim().length > 0)
    || (typeof personality?.personaPrompt === 'string' && personality.personaPrompt.trim().length > 0)

  return {
    personaConfigured,
    emotion: getEmotionFormState(modules, 'noop').scheme,
    relationship: getRelationshipFormState(modules, 'noop').scheme,
    memory: getMemoryFormState(modules).scheme,
  }
}

function formatSchemeLabel(value: string) {
  if (value === 'noop') return '关闭'
  if (value === 'dimensional') return 'Dimensional'
  if (value === 'multi-dim') return 'Multi-dim'
  if (value === 'named-multi-dim') return 'Named multi-dim'
  if (value === 'sqlite') return 'SQLite'
  return value
}

function formatMetricSchemeLabel(value: string) {
  if (value === 'named-multi-dim') return '多对象'
  if (value === 'multi-dim') return '多维'
  return formatSchemeLabel(value)
}

function moduleValue(
  schemes: HomeAgentModuleState,
  key: typeof MODULE_STATUS[number]['key'],
) {
  if (key === 'persona') return schemes.personaConfigured ? '已配置' : '未配置'
  return formatSchemeLabel(schemes[key])
}

function moduleEnabled(
  schemes: HomeAgentModuleState,
  key: typeof MODULE_STATUS[number]['key'],
) {
  if (key === 'persona') return schemes.personaConfigured
  return schemes[key] !== 'noop'
}

export default function HomePage() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [provider, setProvider] = useState<'anthropic' | 'openrouter'>('anthropic')
  const [model, setModel] = useState<string>(DEFAULT_MODEL_BY_PROVIDER.anthropic)
  const [baseModules, setBaseModules] = useState<Record<string, unknown> | null>({})
  const [emotionScheme, setEmotionScheme] = useState<EmotionScheme>('noop')
  const [relationshipScheme, setRelationshipScheme] = useState<RelationshipScheme>('noop')
  const [memoryScheme, setMemoryScheme] = useState<MemoryScheme>('noop')
  const [locale, setLocale] = useState<'zh-CN' | 'en-US'>('zh-CN')
  const router = useRouter()

  async function loadAgents() {
    const res = await fetch('/api/agents')
    const data = await res.json()
    setAgents(data.agents)
  }

  useEffect(() => {
    void loadAgents()
    void loadLocale()
  }, [])

  async function loadLocale() {
    const response = await fetch('/api/settings/locale', { cache: 'no-store' })
    const data = await response.json().catch(() => null) as { locale?: 'zh-CN' | 'en-US' } | null
    if (data?.locale === 'zh-CN' || data?.locale === 'en-US') {
      setLocale(data.locale)
    }
  }

  async function updateLocale(nextLocale: 'zh-CN' | 'en-US') {
    setLocale(nextLocale)
    const response = await fetch('/api/settings/locale', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locale: nextLocale }),
    })
    if (!response.ok) {
      await loadLocale()
      alert(nextLocale === 'en-US' ? 'Failed to update language.' : '语言更新失败。')
    }
  }

  useEffect(() => {
    setSelectedAgentId((current) => resolveSelectedAgentId(agents, current))
  }, [agents])

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId) ?? agents[0] ?? null,
    [agents, selectedAgentId],
  )
  const selectedSchemes = selectedAgent ? readAgentSchemes(selectedAgent.modules) : null
  const selectedAvatarUrl = selectedAgent ? getPersonalityAvatarUrl(selectedAgent.modules) : ''
  const configuredCount = selectedSchemes
    ? countConfiguredHomeModules(selectedSchemes)
    : 0

  function resetForm() {
    setShowForm(false)
    setEditingId(null)
    setName('')
    setDescription('')
    setProvider('anthropic')
    setModel(DEFAULT_MODEL_BY_PROVIDER.anthropic)
    setBaseModules({})
    setEmotionScheme('noop')
    setRelationshipScheme('noop')
    setMemoryScheme('noop')
  }

  function startEdit(agent: Agent) {
    const emotion = getEmotionFormState(agent.modules, 'noop')
    const relationship = getRelationshipFormState(agent.modules, 'noop')
    const memory = getMemoryFormState(agent.modules)

    setEditingId(agent.id)
    setName(agent.name)
    setDescription(agent.description ?? '')
    setProvider(agent.provider ?? 'anthropic')
    setModel(agent.model)
    setBaseModules(agent.modules ?? {})
    setEmotionScheme(emotion.scheme)
    setRelationshipScheme(relationship.scheme)
    setMemoryScheme(memory.scheme)
    setSelectedAgentId(agent.id)
    setShowForm(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return

    const modules = buildModules(
      baseModules,
      { scheme: emotionScheme },
      { scheme: relationshipScheme },
      { scheme: memoryScheme },
    )

    if (editingId) {
      await fetch(`/api/agents/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description,
          provider,
          model,
          modules,
        }),
      })
    } else {
      await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description,
          provider,
          model,
          modules,
        }),
      })
    }

    resetForm()
    await loadAgents()
  }

  async function handleDelete(id: string) {
    if (!confirm('删除这个虚拟人及其全部对话吗？')) return
    const response = await fetch(`/api/agents/${id}`, { method: 'DELETE' })
    if (!response.ok) {
      const body = await response.json().catch(() => null)
      const message =
        body && typeof body.error === 'string'
          ? body.error
          : `删除失败（${response.status}）`
      alert(message)
      return
    }
    await loadAgents()
  }

  async function handleChat(agentId: string) {
    router.push(`/chat?agent=${agentId}`)
  }

  function openManager(
    agentId: string,
    section: AgentManagerSection,
  ) {
    router.push(`/agent/${agentId}/${section}`)
  }

  return (
    <main className="home">
      <div className="ambient" aria-hidden />
      <div className="home-wrap">
        <header className="home-head">
          <div className="title-block">
            <p className="eyebrow">Multi Agent System</p>
            <h1 className="home-title">角色大厅</h1>
            <p className="home-sub">
              管理你的虚拟人格、关系状态、记忆系统和运行入口。这里是进入每个角色之前的总控台。
            </p>
          </div>
          <div className="head-actions">
            <label className="locale-switch">
              <span>{locale === 'en-US' ? 'System language' : '系统语言'}</span>
              <select
                value={locale}
                onChange={(event) => {
                  void updateLocale(event.target.value === 'en-US' ? 'en-US' : 'zh-CN')
                }}
              >
                <option value="zh-CN">中文</option>
                <option value="en-US">English</option>
              </select>
            </label>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => router.push('/daemon')}
            >
              Daemon
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                resetForm()
                setShowForm(true)
              }}
            >
              <span className="button-mark">+</span> 新建虚拟人
            </button>
          </div>
        </header>

        {showForm && (
          <form onSubmit={handleSubmit} className="creation-panel">
            <div className="form-head">
              <div>
                <p className="panel-label">Persona Builder</p>
                <h3 className="form-title">
                  {editingId ? '编辑虚拟人' : '创建虚拟人'}
                </h3>
              </div>
              <button type="button" className="btn btn-ghost" onClick={resetForm}>
                收起
              </button>
            </div>

            <div className="form-grid">
              <label className="field">
                <span className="field-label">名称</span>
                <input
                  className="input"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="例如 Hazel、Orion、Sage"
                  autoFocus
                />
              </label>

              <label className="field wide">
                <span className="field-label">描述</span>
                <input
                  className="input"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="例如：一位喜欢深夜倾听和看星星的安静陪伴者"
                />
              </label>

              <label className="field">
                <span className="field-label">模型提供方</span>
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

              <label className="field wide">
                <span className="field-label">模型</span>
                <input
                  className="input"
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  placeholder={
                    provider === 'openrouter'
                      ? '例如 anthropic/claude-sonnet-4.6、openai/gpt-5.2'
                      : '例如 claude-sonnet-4-6、claude-haiku-4-5-20251001'
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

              <label className="field">
                <span className="field-label">情绪方案</span>
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

              <label className="field">
                <span className="field-label">关系方案</span>
                <select
                  className="input"
                  value={relationshipScheme}
                  onChange={(event) =>
                    setRelationshipScheme(event.target.value as RelationshipScheme)}
                >
                  <option value="noop">noop</option>
                  <option value="multi-dim">multi-dim</option>
                  <option value="named-multi-dim">named-multi-dim</option>
                </select>
              </label>

              <label className="field">
                <span className="field-label">记忆方案</span>
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
            </div>

            <div className="form-actions">
              <button type="submit" className="btn btn-primary">
                {editingId ? '保存更改' : '创建虚拟人'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={resetForm}>
                取消
              </button>
            </div>
          </form>
        )}

        {agents.length === 0 && !showForm && (
          <section className="empty-stage">
            <div className="empty-art" aria-hidden />
            <div className="empty-copy">
              <p className="panel-label">No persona online</p>
              <h2>还没有虚拟人</h2>
              <p>先创建一个角色，再进入聊天、人设、情绪、关系和记忆管理。</p>
              <button
                className="btn btn-primary"
                onClick={() => {
                  resetForm()
                  setShowForm(true)
                }}
              >
                <span className="button-mark">+</span> 创建第一个虚拟人
              </button>
            </div>
          </section>
        )}

        {agents.length > 0 && selectedAgent && selectedSchemes && (
          <section className="hall-grid">
            <aside className="roster-panel" aria-label="虚拟人列表">
              <div className="panel-topline">
                <div>
                  <p className="panel-label">Roster</p>
                  <h2>虚拟人格</h2>
                </div>
                <span className="count-pill">{agents.length}</span>
              </div>

              <div className="roster-list">
                {agents.map((agent) => {
                  const schemes = readAgentSchemes(agent.modules)
                  const avatarUrl = getPersonalityAvatarUrl(agent.modules)
                  const isActive = agent.id === selectedAgent.id

                  return (
                    <button
                      key={agent.id}
                      type="button"
                      className={`roster-item ${isActive ? 'roster-item-active' : ''}`}
                      onClick={() => setSelectedAgentId(agent.id)}
                    >
                      <span
                        className="avatar avatar-list"
                        style={avatarUrl ? undefined : { backgroundImage: gradientFor(agent.id) }}
                      >
                        {avatarUrl ? (
                          <img src={avatarUrl} alt="" />
                        ) : (
                          initials(agent.name)
                        )}
                      </span>
                      <span className="roster-copy">
                        <strong>{agent.name}</strong>
                        <small>{MODEL_LABELS[agent.model] ?? agent.model}</small>
                      </span>
                      <span className="roster-score">
                        {countConfiguredHomeModules(schemes)}/4
                      </span>
                    </button>
                  )
                })}
              </div>
            </aside>

            <section className="focus-panel" aria-label="当前虚拟人">
              <div className="focus-art" aria-hidden />
              <div className="focus-content">
                <div className="focus-portrait">
                  <div
                    className="portrait-backdrop"
                    style={selectedAvatarUrl ? undefined : { backgroundImage: 'url(/home-assets/portrait-backdrop.png)' }}
                  >
                    {selectedAvatarUrl ? (
                      <img src={selectedAvatarUrl} alt="" />
                    ) : (
                      <span>{initials(selectedAgent.name)}</span>
                    )}
                  </div>
                </div>

                <div className="focus-main">
                  <div className="agent-badges">
                    <span className="provider-pill">{selectedAgent.provider}</span>
                    <span className="model-pill">
                      {MODEL_LABELS[selectedAgent.model] ?? selectedAgent.model}
                    </span>
                  </div>
                  <h2 className="agent-name">{selectedAgent.name}</h2>
                  <p className="agent-desc">
                    {selectedAgent.description || '这个虚拟人还没有描述。可以进入人设页补充角色背景、说话风格和互动边界。'}
                  </p>

                  <div className="focus-metrics">
                    <div>
                      <strong>{configuredCount}/4</strong>
                      <span>核心模块</span>
                    </div>
                    <div>
                      <strong>{formatMetricSchemeLabel(selectedSchemes.relationship)}</strong>
                      <span>关系系统</span>
                    </div>
                    <div>
                      <strong>{formatMetricSchemeLabel(selectedSchemes.memory)}</strong>
                      <span>记忆系统</span>
                    </div>
                  </div>

                  <div className="focus-actions">
                    <button
                      className="btn btn-primary"
                      onClick={() => handleChat(selectedAgent.id)}
                    >
                      打开聊天
                    </button>
                    <button
                      className="btn"
                      onClick={() => openManager(selectedAgent.id, 'personality')}
                    >
                      人设档案
                    </button>
                    <button className="btn btn-ghost" onClick={() => startEdit(selectedAgent)}>
                      编辑基础信息
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={() => handleDelete(selectedAgent.id)}
                    >
                      删除虚拟人
                    </button>
                  </div>
                </div>
              </div>
            </section>

            <aside className="system-panel" aria-label="角色系统状态">
              <div className="panel-topline">
                <div>
                  <p className="panel-label">Systems</p>
                  <h2>角色系统</h2>
                </div>
                <span className="count-pill">{configuredCount}/4</span>
              </div>

              <div className="module-stack">
                {MODULE_STATUS.map((module) => {
                  const enabled = moduleEnabled(selectedSchemes, module.key)
                  return (
                    <button
                      key={module.key}
                      type="button"
                      className={`module-tile module-${module.key} ${enabled ? 'module-on' : ''}`}
                      onClick={() => openManager(selectedAgent.id, module.section)}
                    >
                      <span className="module-texture" aria-hidden />
                      <span className="module-copy">
                        <span className="module-row">
                          <strong>{module.title}</strong>
                          <em>{moduleValue(selectedSchemes, module.key)}</em>
                        </span>
                        <small>{module.subtitle}</small>
                      </span>
                    </button>
                  )
                })}
              </div>

              <div className="manager-strip">
                {AGENT_MANAGER_TILES.map((tile) => (
                  <button
                    key={tile.section}
                    className="manager-tile"
                    onClick={() => openManager(selectedAgent.id, tile.section)}
                  >
                    <span>{tile.index}</span>
                    <strong>{tile.title}</strong>
                  </button>
                ))}
              </div>
            </aside>
          </section>
        )}
      </div>

      <style jsx>{`
        .home {
          min-height: 100vh;
          position: relative;
          overflow: hidden;
          padding: 48px 22px 76px;
          background:
            linear-gradient(180deg, rgba(2, 6, 15, 0.4), rgba(2, 6, 15, 0.88)),
            #030612;
        }
        .ambient {
          position: fixed;
          inset: 0;
          z-index: 0;
          background:
            linear-gradient(90deg, rgba(3, 6, 18, 0.82), rgba(3, 6, 18, 0.45) 42%, rgba(3, 6, 18, 0.88)),
            url('/home-assets/role-hall-bg.png') center / cover no-repeat;
          opacity: 0.72;
          transform: scale(1.04);
          pointer-events: none;
        }
        .ambient::after {
          content: '';
          position: absolute;
          inset: 0;
          background:
            linear-gradient(180deg, rgba(3, 6, 18, 0.18), rgba(3, 6, 18, 0.9)),
            radial-gradient(circle at 72% 18%, rgba(34, 197, 94, 0.14), transparent 34%),
            radial-gradient(circle at 12% 80%, rgba(245, 158, 11, 0.12), transparent 34%);
        }
        .home-wrap {
          position: relative;
          z-index: 1;
          max-width: 1440px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          gap: 22px;
        }
        .home-head {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          gap: 22px;
          flex-wrap: wrap;
          padding: 6px 2px 10px;
        }
        .title-block {
          max-width: 720px;
        }
        .eyebrow,
        .panel-label {
          margin: 0 0 9px;
          color: #90a4bc;
          font-size: 11px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
        }
        .home-title {
          margin: 0;
          font-family: var(--font-display);
          font-size: clamp(42px, 6vw, 78px);
          font-weight: 500;
          line-height: 0.95;
          color: #f8fafc;
          letter-spacing: 0;
          text-shadow: 0 18px 60px rgba(0, 0, 0, 0.52);
        }
        .home-sub {
          max-width: 64ch;
          margin: 14px 0 0;
          color: #b7c3d4;
          font-size: 15px;
          line-height: 1.72;
        }
        .head-actions,
        .form-actions,
        .focus-actions {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }
        .locale-switch {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          min-height: 40px;
          padding: 0 10px;
          border: 1px solid rgba(148, 163, 184, 0.24);
          border-radius: 999px;
          background: rgba(15, 23, 42, 0.66);
          color: #cbd5e1;
          font-size: 12px;
          font-weight: 700;
        }
        .locale-switch select {
          height: 28px;
          border: 0;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.08);
          color: #f8fafc;
          padding: 0 8px;
          font: inherit;
        }
        .button-mark {
          font-size: 16px;
          line-height: 1;
        }
        .creation-panel,
        .roster-panel,
        .focus-panel,
        .system-panel,
        .empty-stage {
          border: 1px solid rgba(148, 163, 184, 0.18);
          background:
            linear-gradient(180deg, rgba(15, 23, 42, 0.82), rgba(8, 13, 25, 0.72)),
            rgba(3, 7, 18, 0.6);
          box-shadow:
            0 24px 80px rgba(0, 0, 0, 0.35),
            inset 0 1px 0 rgba(255, 255, 255, 0.04);
          backdrop-filter: blur(18px) saturate(135%);
          -webkit-backdrop-filter: blur(18px) saturate(135%);
        }
        .creation-panel {
          border-radius: 22px;
          padding: 20px;
        }
        .form-head,
        .panel-topline {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 14px;
        }
        .form-title,
        .panel-topline h2 {
          margin: 0;
          color: #f8fafc;
          font-family: var(--font-display);
          font-size: 22px;
          font-weight: 500;
          letter-spacing: 0;
        }
        .form-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 14px;
          margin-top: 18px;
        }
        .field {
          display: flex;
          flex-direction: column;
          gap: 7px;
        }
        .field.wide {
          grid-column: span 2;
        }
        .field-label {
          color: #98a8bd;
          font-size: 12px;
          font-weight: 500;
        }
        .hall-grid {
          display: grid;
          grid-template-columns: minmax(220px, 280px) minmax(0, 1fr) minmax(260px, 330px);
          gap: 16px;
          align-items: stretch;
          min-height: 640px;
        }
        .roster-panel,
        .system-panel {
          border-radius: 24px;
          padding: 18px;
          display: flex;
          flex-direction: column;
          gap: 16px;
          min-width: 0;
        }
        .count-pill {
          min-width: 36px;
          height: 28px;
          padding: 0 10px;
          border-radius: 999px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: #d8f5e3;
          background: rgba(34, 197, 94, 0.13);
          border: 1px solid rgba(34, 197, 94, 0.26);
          font-size: 12px;
          font-weight: 700;
        }
        .roster-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
          min-height: 0;
          overflow: auto;
          padding-right: 2px;
        }
        .roster-item {
          width: 100%;
          display: grid;
          grid-template-columns: 46px minmax(0, 1fr) auto;
          gap: 11px;
          align-items: center;
          padding: 10px;
          border: 1px solid rgba(148, 163, 184, 0.12);
          border-radius: 16px;
          background: rgba(15, 23, 42, 0.42);
          color: #eef4ff;
          text-align: left;
          cursor: pointer;
          transition:
            transform 160ms ease,
            border-color 160ms ease,
            background 160ms ease;
        }
        .roster-item:hover,
        .roster-item-active {
          transform: translateY(-1px);
          border-color: rgba(34, 197, 94, 0.34);
          background: linear-gradient(135deg, rgba(34, 197, 94, 0.13), rgba(15, 23, 42, 0.62));
        }
        .avatar {
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          overflow: hidden;
          color: rgba(255, 255, 255, 0.95);
          font-family: var(--font-display);
          font-weight: 600;
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.22),
            0 16px 30px rgba(0, 0, 0, 0.24);
        }
        .avatar-list {
          width: 46px;
          height: 46px;
          border-radius: 14px;
          border: 1px solid rgba(255, 255, 255, 0.18);
          font-size: 15px;
        }
        .avatar img,
        .portrait-backdrop img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
        .roster-copy {
          display: flex;
          flex-direction: column;
          gap: 3px;
          min-width: 0;
        }
        .roster-copy strong,
        .manager-tile strong {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .roster-copy strong {
          font-size: 14px;
        }
        .roster-copy small {
          color: #93a4bc;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 11px;
        }
        .roster-score {
          color: #a7f3d0;
          font-size: 11px;
          font-weight: 700;
        }
        .focus-panel {
          position: relative;
          overflow: hidden;
          border-radius: 28px;
          min-width: 0;
        }
        .focus-art {
          position: absolute;
          inset: 0;
          background:
            linear-gradient(90deg, rgba(4, 8, 20, 0.68), rgba(4, 8, 20, 0.2) 52%, rgba(4, 8, 20, 0.86)),
            url('/home-assets/role-hall-bg.png') center / cover no-repeat;
          opacity: 0.9;
        }
        .focus-art::after {
          content: '';
          position: absolute;
          inset: 0;
          background:
            linear-gradient(180deg, rgba(3, 7, 18, 0.08), rgba(3, 7, 18, 0.92)),
            radial-gradient(circle at 40% 28%, rgba(34, 197, 94, 0.12), transparent 36%);
        }
        .focus-content {
          position: relative;
          z-index: 1;
          min-height: 100%;
          display: grid;
          grid-template-columns: minmax(250px, 36%) minmax(0, 1fr);
          gap: 24px;
          align-items: end;
          padding: clamp(22px, 4vw, 38px);
        }
        .focus-portrait {
          align-self: stretch;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .portrait-backdrop {
          width: min(100%, 330px);
          aspect-ratio: 0.78;
          border-radius: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          background-size: cover;
          background-position: center;
          border: 1px solid rgba(255, 255, 255, 0.22);
          box-shadow:
            0 34px 82px rgba(0, 0, 0, 0.48),
            inset 0 1px 0 rgba(255, 255, 255, 0.18);
        }
        .portrait-backdrop span {
          width: 108px;
          height: 108px;
          border-radius: 32px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: #e8fff3;
          background: rgba(2, 6, 15, 0.46);
          border: 1px solid rgba(255, 255, 255, 0.24);
          font-family: var(--font-display);
          font-size: 42px;
          font-weight: 600;
          backdrop-filter: blur(10px);
        }
        .focus-main {
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .agent-badges {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .provider-pill,
        .model-pill {
          display: inline-flex;
          align-items: center;
          min-height: 28px;
          padding: 7px 10px;
          border-radius: 999px;
          line-height: 1;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          white-space: nowrap;
        }
        .provider-pill {
          color: #d8f5e3;
          background: rgba(34, 197, 94, 0.14);
          border: 1px solid rgba(34, 197, 94, 0.28);
        }
        .model-pill {
          max-width: min(100%, 280px);
          color: #dbe8ff;
          background: rgba(148, 163, 184, 0.12);
          border: 1px solid rgba(148, 163, 184, 0.18);
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .agent-name {
          margin: 0;
          color: #f8fafc;
          font-family: var(--font-display);
          font-size: clamp(42px, 6vw, 76px);
          line-height: 0.96;
          font-weight: 520;
          letter-spacing: 0;
          text-shadow: 0 22px 70px rgba(0, 0, 0, 0.62);
        }
        .agent-desc {
          max-width: 62ch;
          margin: 0;
          color: #c1ccda;
          font-size: 15px;
          line-height: 1.75;
        }
        .focus-metrics {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
        }
        .focus-metrics div {
          min-width: 0;
          border: 1px solid rgba(148, 163, 184, 0.16);
          border-radius: 16px;
          padding: 13px 14px;
          background: rgba(3, 7, 18, 0.46);
        }
        .focus-metrics strong {
          display: block;
          color: #f8fafc;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 17px;
        }
        .focus-metrics span {
          display: block;
          margin-top: 4px;
          color: #91a3bc;
          font-size: 12px;
        }
        .module-stack {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .module-tile {
          position: relative;
          overflow: hidden;
          width: 100%;
          min-height: 88px;
          padding: 14px;
          border: 1px solid rgba(148, 163, 184, 0.14);
          border-radius: 18px;
          background: rgba(15, 23, 42, 0.48);
          color: #eef4ff;
          text-align: left;
          cursor: pointer;
          transition:
            transform 160ms ease,
            border-color 160ms ease,
            background 160ms ease;
        }
        .module-tile:hover,
        .module-on {
          transform: translateY(-1px);
          border-color: rgba(34, 197, 94, 0.26);
          background: rgba(12, 29, 31, 0.58);
        }
        .module-texture {
          position: absolute;
          inset: 0;
          background-image:
            linear-gradient(90deg, rgba(3, 7, 18, 0.22), rgba(3, 7, 18, 0.72)),
            url('/home-assets/module-texture.png');
          background-size: cover;
          opacity: 0.34;
        }
        .module-emotion .module-texture {
          background-position: 48% 50%;
        }
        .module-relationship .module-texture {
          background-position: 68% 38%;
        }
        .module-memory .module-texture {
          background-position: 78% 78%;
        }
        .module-copy {
          position: relative;
          z-index: 1;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .module-row {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: center;
        }
        .module-row strong {
          color: #f8fafc;
          font-size: 15px;
        }
        .module-row em {
          color: #a7f3d0;
          font-size: 11px;
          font-style: normal;
          white-space: nowrap;
        }
        .module-copy small {
          color: #a7b5c8;
          line-height: 1.45;
        }
        .manager-strip {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 9px;
          margin-top: auto;
        }
        .manager-tile {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
          padding: 10px;
          border: 1px solid rgba(148, 163, 184, 0.13);
          border-radius: 14px;
          background: rgba(15, 23, 42, 0.42);
          color: #eef4ff;
          cursor: pointer;
          text-align: left;
        }
        .manager-tile:hover {
          border-color: rgba(245, 158, 11, 0.28);
          background: rgba(245, 158, 11, 0.1);
        }
        .manager-tile span {
          color: #f9d58b;
          font-family: var(--font-display);
          font-size: 11px;
        }
        .manager-tile strong {
          font-size: 13px;
        }
        .empty-stage {
          min-height: 560px;
          border-radius: 28px;
          overflow: hidden;
          display: grid;
          grid-template-columns: minmax(0, 1.1fr) minmax(320px, 0.9fr);
        }
        .empty-art {
          background:
            linear-gradient(90deg, rgba(3, 7, 18, 0.08), rgba(3, 7, 18, 0.52)),
            url('/home-assets/empty-dossier.png') center / cover no-repeat;
          min-height: 420px;
        }
        .empty-copy {
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 16px;
          padding: clamp(26px, 5vw, 52px);
        }
        .empty-copy h2 {
          margin: 0;
          color: #f8fafc;
          font-family: var(--font-display);
          font-size: clamp(34px, 5vw, 58px);
          line-height: 1;
          letter-spacing: 0;
        }
        .empty-copy p {
          margin: 0;
          color: #b7c3d4;
          line-height: 1.72;
        }
        @media (max-width: 1180px) {
          .hall-grid {
            grid-template-columns: minmax(220px, 280px) minmax(0, 1fr);
          }
          .system-panel {
            grid-column: 1 / -1;
          }
          .module-stack {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .manager-strip {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }
        }
        @media (max-width: 860px) {
          .home {
            padding: 28px 14px 56px;
          }
          .hall-grid,
          .empty-stage {
            grid-template-columns: 1fr;
          }
          .focus-content {
            grid-template-columns: 1fr;
          }
          .focus-portrait {
            align-self: center;
          }
          .portrait-backdrop {
            max-width: 260px;
          }
          .form-grid,
          .focus-metrics,
          .module-stack,
          .manager-strip {
            grid-template-columns: 1fr;
          }
          .field.wide {
            grid-column: auto;
          }
          .roster-list {
            max-height: 360px;
          }
          .empty-art {
            min-height: 320px;
          }
        }
        @media (max-width: 520px) {
          .home-title {
            font-size: 42px;
          }
          .agent-name {
            font-size: 40px;
          }
          .focus-content,
          .creation-panel,
          .roster-panel,
          .system-panel {
            padding: 16px;
          }
          .roster-item {
            grid-template-columns: 42px minmax(0, 1fr);
          }
          .roster-score {
            display: none;
          }
        }
      `}</style>
    </main>
  )
}
