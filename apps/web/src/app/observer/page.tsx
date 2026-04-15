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
    if (!currentSessionId && data.sessions.length > 0) {
      setCurrentSessionId(data.sessions[0].id)
    }
  }, [currentSessionId])

  useEffect(() => {
    loadSessions()
  }, [loadSessions])

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
    <div style={{ display: 'flex', height: '100vh' }}>
      <SessionsList
        sessions={sessions}
        currentId={currentSessionId}
        onSelect={setCurrentSessionId}
        onClearAll={handleClearAll}
      />
      <TurnTree turns={turns} currentCallId={currentCallId} onSelectCall={setCurrentCallId} />
      <DetailPane callId={currentCallId} />
    </div>
  )
}
