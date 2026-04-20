'use client'

import { useDeferredValue, useEffect, useState, useTransition } from 'react'
import { getSqliteMemoryToolbarState } from './MemoryManager.sqlite.state'

interface AgentMemoryMeta {
  agentId: string
  scheme: string | null
  supportedSchemes: string[]
  configured: boolean
}

interface MemoryManagerProps {
  agentId: string
  meta: AgentMemoryMeta
}

interface SqliteMemory {
  id: string
  sessionId: string
  summary: string
  tags: string[]
  importance: number
  createdAt: string
}

interface ConsolidationReport {
  before: number
  after: number
  kept: number
  rewritten: number
  merged: number
}

const DATE_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

export default function MemoryManagerSqlite({ agentId }: MemoryManagerProps) {
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [memories, setMemories] = useState<SqliteMemory[]>([])
  const [loading, setLoading] = useState(true)
  const [isConsolidating, setIsConsolidating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const toolbarState = getSqliteMemoryToolbarState({
    loading,
    pending,
    isConsolidating,
    memoryCount: memories.length,
  })

  async function refresh(search = deferredQuery) {
    setLoading(true)
    setError(null)

    try {
      const searchText = search.trim()
      const response = await fetch(
        `/api/agents/${agentId}/memory/sqlite${searchText ? `?q=${encodeURIComponent(searchText)}` : ''}`,
        { cache: 'no-store' },
      )
      const data = await response.json()
      if (!response.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : 'Failed to load sqlite memories')
      }

      setMemories(Array.isArray(data.memories) ? data.memories : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sqlite memories')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh(deferredQuery)
  }, [agentId, deferredQuery])

  async function handleDelete(memoryId: string) {
    if (!window.confirm('Delete this sqlite memory?')) {
      return
    }

    setError(null)
    setNotice(null)

    const response = await fetch(`/api/agents/${agentId}/memory/sqlite/${memoryId}`, {
      method: 'DELETE',
    })
    const data = await response.json()
    if (!response.ok) {
      setError(typeof data?.error === 'string' ? data.error : 'Failed to delete sqlite memory')
      return
    }

    setNotice('SQLite memory deleted.')
    startTransition(() => {
      void refresh()
    })
  }

  async function handleConsolidate() {
    setError(null)
    setNotice('正在整理 sqlite memories，这一步可能需要接近 1 分钟。')
    setIsConsolidating(true)

    try {
      const response = await fetch(`/api/agents/${agentId}/memory/sqlite/consolidate`, {
        method: 'POST',
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : 'Failed to consolidate sqlite memories')
      }

      const report = data as ConsolidationReport
      setNotice(
        `SQLite memory consolidate 完成：${report.before} -> ${report.after}，保留 ${report.kept}，重写 ${report.rewritten}，合并 ${report.merged}。`,
      )
      startTransition(() => {
        void refresh()
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to consolidate sqlite memories')
      setNotice(null)
    } finally {
      setIsConsolidating(false)
    }
  }

  return (
    <div className="sqlite-manager">
      <div className="sqlite-toolbar">
        <label className="sqlite-search">
          <span>Search</span>
          <input
            className="sqlite-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="按 summary 或 tags 搜索"
          />
        </label>

        <div className="sqlite-toolbar-actions">
          <button
            type="button"
            className="sqlite-button"
            onClick={() => startTransition(() => { void refresh() })}
            disabled={toolbarState.refreshDisabled}
          >
            Refresh
          </button>
          <button
            type="button"
            className="sqlite-button sqlite-button-primary"
            onClick={handleConsolidate}
            disabled={toolbarState.consolidateDisabled}
          >
            {toolbarState.consolidateLabel}
          </button>
        </div>
      </div>

      {notice && <p className="sqlite-notice">{notice}</p>}
      {error && <p className="sqlite-error">{error}</p>}

      <div className="sqlite-summary-row">
        <p className="sqlite-copy">
          当前 sqlite memories: <strong>{memories.length}</strong>
          {deferredQuery.trim() ? `，筛选词：${deferredQuery.trim()}` : ''}
        </p>
        {toolbarState.status && <span className="sqlite-status">{toolbarState.status}</span>}
      </div>

      {loading && memories.length === 0 ? (
        <div className="sqlite-empty">
          <h3>正在加载 sqlite memories…</h3>
        </div>
      ) : memories.length === 0 ? (
        <div className="sqlite-empty">
          <h3>还没有可管理的 sqlite 记忆</h3>
          <p>先去聊天几轮让系统写入 memory，或者清空搜索词查看全部结果。</p>
        </div>
      ) : (
        <div className="sqlite-grid">
          {memories.map((memory) => (
            <article key={memory.id} className="sqlite-memory-card">
              <div className="sqlite-memory-head">
                <div>
                  <p className="sqlite-memory-meta">session {memory.sessionId}</p>
                  <h3>{memory.summary}</h3>
                </div>
                <button
                  type="button"
                  className="sqlite-button sqlite-button-danger"
                  onClick={() => handleDelete(memory.id)}
                  disabled={toolbarState.deleteDisabled}
                >
                  Delete
                </button>
              </div>

              <div className="sqlite-memory-details">
                <span>{DATE_FORMATTER.format(new Date(memory.createdAt))}</span>
                <span>importance {memory.importance.toFixed(2)}</span>
                <span>{memory.id}</span>
              </div>

              <div className="sqlite-tags">
                {memory.tags.map((tag) => (
                  <span key={`${memory.id}-${tag}`} className="sqlite-tag">
                    {tag}
                  </span>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}

      <style jsx>{`
        .sqlite-manager {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .sqlite-toolbar {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          gap: 16px;
          flex-wrap: wrap;
        }
        .sqlite-search {
          display: flex;
          flex-direction: column;
          gap: 8px;
          min-width: min(100%, 360px);
        }
        .sqlite-search span {
          font-size: 12px;
          color: var(--fg-muted);
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }
        .sqlite-input {
          width: 100%;
          border-radius: 16px;
          border: 1px solid var(--border);
          background: rgba(255, 255, 255, 0.04);
          color: var(--fg);
          padding: 12px 14px;
          outline: none;
        }
        .sqlite-toolbar-actions {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }
        .sqlite-button {
          border: 1px solid var(--border);
          border-radius: 999px;
          padding: 10px 14px;
          background: rgba(255, 255, 255, 0.04);
          color: var(--fg);
          cursor: pointer;
        }
        .sqlite-button:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }
        .sqlite-button-primary {
          border-color: rgba(52, 211, 153, 0.3);
          background: rgba(52, 211, 153, 0.16);
        }
        .sqlite-button-danger {
          border-color: rgba(248, 113, 113, 0.25);
          background: rgba(248, 113, 113, 0.12);
          color: #ffd8d8;
        }
        .sqlite-notice,
        .sqlite-error {
          border-radius: 16px;
          padding: 12px 14px;
          line-height: 1.6;
        }
        .sqlite-notice {
          background: rgba(52, 211, 153, 0.12);
          border: 1px solid rgba(52, 211, 153, 0.22);
          color: #b9f5d7;
        }
        .sqlite-error {
          background: rgba(248, 113, 113, 0.12);
          border: 1px solid rgba(248, 113, 113, 0.22);
          color: #ffd8d8;
        }
        .sqlite-summary-row {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: center;
          flex-wrap: wrap;
        }
        .sqlite-copy {
          color: var(--fg-muted);
          line-height: 1.6;
        }
        .sqlite-status {
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--fg-subtle);
        }
        .sqlite-empty {
          border: 1px dashed var(--border);
          border-radius: 20px;
          padding: 22px;
          background: rgba(255, 255, 255, 0.03);
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .sqlite-empty p {
          color: var(--fg-muted);
          line-height: 1.7;
        }
        .sqlite-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: 16px;
        }
        .sqlite-memory-card {
          border-radius: 22px;
          border: 1px solid rgba(129, 140, 248, 0.18);
          background:
            linear-gradient(160deg, rgba(129, 140, 248, 0.12), rgba(255, 255, 255, 0.03)),
            rgba(10, 13, 24, 0.88);
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .sqlite-memory-head {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: flex-start;
        }
        .sqlite-memory-head h3 {
          font-size: 18px;
          line-height: 1.5;
        }
        .sqlite-memory-meta {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--fg-subtle);
          margin-bottom: 8px;
        }
        .sqlite-memory-details {
          display: flex;
          flex-direction: column;
          gap: 6px;
          color: var(--fg-muted);
          font-size: 13px;
          word-break: break-all;
        }
        .sqlite-tags {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        .sqlite-tag {
          border-radius: 999px;
          padding: 6px 10px;
          font-size: 12px;
          background: rgba(129, 140, 248, 0.16);
          border: 1px solid rgba(129, 140, 248, 0.24);
          color: #d9ddff;
        }
      `}</style>
    </div>
  )
}
