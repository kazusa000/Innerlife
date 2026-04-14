'use client'

import { useCallback, useEffect, useState } from 'react'
import { Sidebar } from './Sidebar'
import { ChatArea } from './ChatArea'

interface Session {
  id: string
  title: string | null
  updatedAt: number
}

export default function ChatPage() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  const loadSessions = useCallback(async () => {
    const res = await fetch('/api/sessions')
    const data = (await res.json()) as { sessions: Session[] }
    setSessions(data.sessions)
    return data.sessions
  }, [])

  useEffect(() => {
    ;(async () => {
      const list = await loadSessions()
      if (list.length > 0) {
        setCurrentId(list[0].id)
      } else {
        const res = await fetch('/api/sessions', { method: 'POST' })
        const data = (await res.json()) as { session: Session }
        setSessions([data.session])
        setCurrentId(data.session.id)
      }
      setLoaded(true)
    })()
  }, [loadSessions])

  async function handleNew() {
    const res = await fetch('/api/sessions', { method: 'POST' })
    const data = (await res.json()) as { session: Session }
    setSessions((prev) => [data.session, ...prev])
    setCurrentId(data.session.id)
  }

  async function handleDelete(id: string) {
    await fetch(`/api/sessions/${id}`, { method: 'DELETE' })
    const remaining = sessions.filter((s) => s.id !== id)
    setSessions(remaining)
    if (currentId === id) {
      if (remaining.length > 0) {
        setCurrentId(remaining[0].id)
      } else {
        const res = await fetch('/api/sessions', { method: 'POST' })
        const data = (await res.json()) as { session: Session }
        setSessions([data.session])
        setCurrentId(data.session.id)
      }
    }
  }

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <Sidebar
        sessions={sessions}
        currentId={currentId}
        onSelect={setCurrentId}
        onNew={handleNew}
        onDelete={handleDelete}
      />
      {loaded && currentId ? (
        <ChatArea key={currentId} sessionId={currentId} onFirstMessage={loadSessions} />
      ) : (
        <div style={{ flex: 1 }} />
      )}
    </div>
  )
}
