'use client'

import { useCallback, useEffect, useState } from 'react'
import { SessionsList } from './SessionsList'
import { TurnTree, type TurnNode } from './TurnTree'
import { DetailPane } from './DetailPane'

interface Session {
  id: string
  title: string | null
  updatedAt: number
}

export default function ObserverPage() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [turns, setTurns] = useState<TurnNode[]>([])
  const [currentCallId, setCurrentCallId] = useState<string | null>(null)

  const loadSessions = useCallback(async () => {
    const res = await fetch('/api/sessions')
    const data = (await res.json()) as { sessions: Session[] }
    setSessions(data.sessions)
  }, [])

  useEffect(() => {
    loadSessions()
  }, [loadSessions])

  useEffect(() => {
    if (!currentSessionId && sessions.length > 0) {
      setCurrentSessionId(sessions[0].id)
    }
  }, [sessions, currentSessionId])

  useEffect(() => {
    if (!currentSessionId) return
    setCurrentCallId(null)
    fetch(`/api/observer/sessions/${currentSessionId}`)
      .then((r) => r.json())
      .then((data: { turns: TurnNode[] }) => setTurns(data.turns))
      .catch(() => setTurns([]))
  }, [currentSessionId])

  async function handleClearAll() {
    await fetch('/api/observer/all', { method: 'DELETE' })
    setTurns([])
    setCurrentCallId(null)
  }

  return (
    <div className="observer-workbench">
      <SessionsList
        sessions={sessions}
        currentId={currentSessionId}
        onSelect={setCurrentSessionId}
        onClearAll={handleClearAll}
      />
      <TurnTree turns={turns} currentCallId={currentCallId} onSelectCall={setCurrentCallId} />
      <DetailPane callId={currentCallId} />

      <style jsx>{`
        .observer-workbench {
          display: grid;
          grid-template-columns: minmax(220px, 260px) minmax(300px, 360px) minmax(0, 1fr);
          gap: 16px;
          height: 100vh;
          position: relative;
          overflow: hidden;
          padding: 18px;
          background:
            linear-gradient(90deg, rgba(4, 7, 15, 0.96), rgba(4, 7, 15, 0.68) 45%, rgba(4, 7, 15, 0.92)),
            url('/workbench-assets/observer-inspector-bg.png') center / cover no-repeat,
            #03060d;
        }

        .observer-workbench::before {
          content: '';
          position: absolute;
          inset: 0;
          pointer-events: none;
          background:
            radial-gradient(circle at 72% 16%, rgba(20, 184, 166, 0.12), transparent 34%),
            linear-gradient(180deg, rgba(3, 6, 13, 0.08), rgba(3, 6, 13, 0.64));
          z-index: 0;
        }

        .observer-workbench > :global(*) {
          position: relative;
          z-index: 1;
        }

        .observer-workbench :global(.observer-sessions),
        .observer-workbench :global(.observer-turns),
        .observer-workbench :global(.observer-detail) {
          min-height: 0;
          border: 1px solid rgba(45, 212, 191, 0.18);
          border-radius: 22px;
          background:
            linear-gradient(180deg, rgba(8, 15, 28, 0.86), rgba(6, 11, 22, 0.78)),
            rgba(6, 11, 22, 0.72);
          box-shadow:
            0 24px 80px rgba(0, 0, 0, 0.35),
            inset 0 1px 0 rgba(255, 255, 255, 0.06);
          backdrop-filter: blur(16px) saturate(140%);
          -webkit-backdrop-filter: blur(16px) saturate(140%);
        }

        .observer-workbench :global(.observer-sessions),
        .observer-workbench :global(.observer-turns) {
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .observer-workbench :global(.observer-detail) {
          display: flex;
          flex-direction: column;
          min-width: 0;
          overflow: hidden;
        }

        .observer-workbench :global(.observer-panel-head) {
          display: flex;
          flex-direction: column;
          gap: 4px;
          padding: 18px 18px 14px;
          border-bottom: 1px solid rgba(148, 163, 184, 0.12);
        }

        .observer-workbench :global(.observer-panel-head-compact) {
          padding-bottom: 12px;
        }

        .observer-workbench :global(.observer-panel-head strong) {
          color: #eef4ff;
          font-size: 18px;
          line-height: 1.2;
        }

        .observer-workbench :global(.observer-eyebrow),
        .observer-workbench :global(.observer-tabs-label) {
          color: #7f93b8;
          font-size: 10px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }

        .observer-workbench :global(.observer-session-list),
        .observer-workbench :global(.observer-turns) {
          overflow-y: auto;
        }

        .observer-workbench :global(.observer-session-list) {
          flex: 1;
          padding: 10px;
        }

        .observer-workbench :global(.observer-session-item),
        .observer-workbench :global(.observer-call-item) {
          width: 100%;
          border: 1px solid transparent;
          background: transparent;
          color: #b8c7df;
          cursor: pointer;
          text-align: left;
          transition: background 140ms ease, border-color 140ms ease, color 140ms ease, transform 140ms ease;
        }

        .observer-workbench :global(.observer-session-item) {
          display: block;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          border-radius: 12px;
          padding: 10px 12px;
          font-size: 13px;
        }

        .observer-workbench :global(.observer-session-item:hover),
        .observer-workbench :global(.observer-call-item:hover) {
          border-color: rgba(96, 165, 250, 0.22);
          background: rgba(20, 32, 58, 0.7);
          color: #eef4ff;
          transform: translateY(-1px);
        }

        .observer-workbench :global(.observer-session-item-active),
        .observer-workbench :global(.observer-call-item-active) {
          border-color: rgba(45, 212, 191, 0.28);
          background: linear-gradient(135deg, rgba(20, 184, 166, 0.16), rgba(37, 99, 235, 0.12));
          color: #f5fbff;
        }

        .observer-workbench :global(.observer-danger-zone) {
          padding: 12px;
          border-top: 1px solid rgba(148, 163, 184, 0.12);
        }

        .observer-workbench :global(.observer-clear-button) {
          width: 100%;
          border: 1px solid rgba(248, 113, 113, 0.3);
          border-radius: 14px;
          padding: 10px 12px;
          background: rgba(127, 29, 29, 0.24);
          color: #fecaca;
          cursor: pointer;
          font-weight: 700;
        }

        .observer-workbench :global(.observer-turns) {
          padding-bottom: 8px;
        }

        .observer-workbench :global(.observer-turn-group) {
          margin: 10px 10px 14px;
          padding: 10px;
          border-radius: 16px;
          background: rgba(4, 9, 20, 0.36);
          border: 1px solid rgba(148, 163, 184, 0.08);
        }

        .observer-workbench :global(.observer-user-text) {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: #d6e3f5;
          font-size: 12px;
          padding: 2px 2px 8px;
        }

        .observer-workbench :global(.observer-call-item) {
          display: flex;
          justify-content: space-between;
          gap: 8px;
          border-radius: 12px;
          padding: 8px 10px;
          margin-top: 5px;
          font-size: 12px;
        }

        .observer-workbench :global(.observer-call-item span:last-child) {
          color: #8192ad;
          min-width: 0;
        }

        .observer-workbench :global(.observer-empty),
        .observer-workbench :global(.observer-detail-empty) {
          color: #91a3bf;
          font-size: 13px;
          text-align: center;
          display: grid;
          place-items: center;
        }

        .observer-workbench :global(.observer-detail-empty) {
          background:
            linear-gradient(180deg, rgba(6, 11, 22, 0.42), rgba(6, 11, 22, 0.84)),
            url('/workbench-assets/observer-empty-art.png') center / min(720px, 90%) auto no-repeat,
            rgba(6, 11, 22, 0.72);
        }

        .observer-workbench :global(.observer-detail-meta) {
          padding: 14px 18px;
          border-bottom: 1px solid rgba(148, 163, 184, 0.12);
          color: #91a3bf;
          font-size: 12px;
        }

        .observer-workbench :global(.observer-tabs) {
          display: flex;
          align-items: center;
          gap: 7px;
          padding: 10px 12px;
          border-bottom: 1px solid rgba(148, 163, 184, 0.12);
          overflow-x: auto;
        }

        .observer-workbench :global(.observer-tabs-spacer) {
          flex: 1;
        }

        .observer-workbench :global(.observer-tab) {
          border: 1px solid transparent;
          border-radius: 999px;
          padding: 7px 11px;
          background: rgba(15, 23, 42, 0.48);
          color: #9fb0ca;
          cursor: pointer;
          white-space: nowrap;
        }

        .observer-workbench :global(.observer-tab-active) {
          border-color: rgba(45, 212, 191, 0.28);
          background: rgba(20, 184, 166, 0.14);
          color: #e5fff9;
        }

        .observer-workbench :global(.observer-detail-body) {
          flex: 1;
          min-height: 0;
          overflow: auto;
          padding: 18px;
          color: #d5e0f0;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace;
          font-size: 12px;
          line-height: 1.7;
          white-space: pre-wrap;
        }

        @media (max-width: 980px) {
          .observer-workbench {
            grid-template-columns: 1fr;
            overflow: auto;
            height: auto;
            min-height: 100vh;
          }

          .observer-workbench :global(.observer-sessions),
          .observer-workbench :global(.observer-turns),
          .observer-workbench :global(.observer-detail) {
            min-height: 320px;
          }
        }
      `}</style>
    </div>
  )
}
