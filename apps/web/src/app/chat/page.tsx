'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Sidebar } from './Sidebar'
import { ChatArea } from './ChatArea'

interface Session {
  id: string
  title: string | null
  agentId: string
  updatedAt: number
}

interface Agent {
  id: string
  name: string
  model: string
}

export default function ChatPage() {
  return (
    <Suspense fallback={<div style={{ flex: 1 }} />}>
      <ChatPageInner />
    </Suspense>
  )
}

function ChatPageInner() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const agentId = searchParams.get('agent')
  const sessionFromUrl = searchParams.get('session')

  const [agent, setAgent] = useState<Agent | null>(null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [currentId, setCurrentId] = useState<string | null>(sessionFromUrl)
  const [loaded, setLoaded] = useState(false)

  // Load agent info
  useEffect(() => {
    if (!agentId) return
    fetch(`/api/agents/${agentId}`)
      .then(r => r.json())
      .then(data => setAgent(data))
      .catch(() => {})
  }, [agentId])

  const loadSessions = useCallback(async () => {
    const res = await fetch('/api/sessions')
    const data = (await res.json()) as { sessions: Session[] }
    const filtered = agentId
      ? data.sessions.filter(s => s.agentId === agentId)
      : data.sessions
    setSessions(filtered)
    return filtered
  }, [agentId])

  useEffect(() => {
    ;(async () => {
      const list = await loadSessions()
      if (sessionFromUrl && list.some(s => s.id === sessionFromUrl)) {
        setCurrentId(sessionFromUrl)
      } else if (list.length > 0) {
        setCurrentId(list[0].id)
      } else if (agentId) {
        const res = await fetch('/api/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentId }),
        })
        const data = (await res.json()) as { session: Session }
        setSessions([data.session])
        setCurrentId(data.session.id)
      }
      setLoaded(true)
    })()
  }, [loadSessions, sessionFromUrl, agentId])

  async function handleNew() {
    const body = agentId ? { agentId } : {}
    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = (await res.json()) as { session: Session }
    setSessions(prev => [data.session, ...prev])
    setCurrentId(data.session.id)
  }

  async function handleDelete(id: string) {
    await fetch(`/api/sessions/${id}`, { method: 'DELETE' })
    const remaining = sessions.filter(s => s.id !== id)
    setSessions(remaining)
    if (currentId === id) {
      if (remaining.length > 0) {
        setCurrentId(remaining[0].id)
      } else {
        await handleNew()
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
        agentName={agent?.name}
        onBack={() => router.push('/')}
      />
      {loaded && currentId ? (
        <ChatArea key={currentId} sessionId={currentId} onFirstMessage={loadSessions} />
      ) : (
        <div style={{ flex: 1 }} />
      )}
    </div>
  )
}
