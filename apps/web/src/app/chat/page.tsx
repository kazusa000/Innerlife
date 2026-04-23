'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ChatArea } from './ChatArea'
import { Sidebar } from './Sidebar'
import type { AgentModules } from './observer-types'

interface Agent {
  id: string
  name: string
  provider: 'anthropic' | 'openrouter'
  model: string
  modules: AgentModules | null
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

  const [agent, setAgent] = useState<Agent | null>(null)
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [isResettingContext, setIsResettingContext] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function loadChatContext() {
      setLoaded(false)
      setAgent(null)
      setCurrentId(null)

      if (!agentId) {
        if (!cancelled) {
          setLoaded(true)
        }
        return
      }

      try {
        const [agentRes, sessionRes] = await Promise.all([
          fetch(`/api/agents/${agentId}`),
          fetch(`/api/agents/${agentId}/active-session`, { method: 'POST' }),
        ])

        if (cancelled) return

        if (agentRes.ok) {
          const agentData = await agentRes.json() as Agent
          if (!cancelled) {
            setAgent(agentData)
          }
        }

        if (sessionRes.ok) {
          const sessionData = await sessionRes.json() as { session: { id: string } }
          if (!cancelled) {
            setCurrentId(sessionData.session.id)
          }
        }
      } catch {
        if (!cancelled) {
          setCurrentId(null)
        }
      } finally {
        if (!cancelled) {
          setLoaded(true)
        }
      }
    }

    loadChatContext()

    return () => {
      cancelled = true
    }
  }, [agentId])

  async function handleResetContext() {
    if (!agentId || isResettingContext) {
      return
    }

    setIsResettingContext(true)
    try {
      const sessionRes = await fetch(`/api/agents/${agentId}/active-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reset: true }),
      })
      if (!sessionRes.ok) {
        throw new Error('failed to reset context')
      }
      const sessionData = await sessionRes.json() as { session: { id: string } }
      setCurrentId(sessionData.session.id)
    } catch {
      // Keep current session if reset fails.
    } finally {
      setIsResettingContext(false)
    }
  }

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <Sidebar
        agentId={agent?.id}
        sessionId={currentId}
        relationshipScheme={typeof agent?.modules?.relationship?.scheme === 'string' ? agent.modules.relationship.scheme : null}
        agentName={agent?.name}
        onBack={() => router.push('/')}
        onResetContext={handleResetContext}
        isResetting={isResettingContext}
      />
      {loaded && currentId ? (
        <ChatArea
          key={currentId}
          sessionId={currentId}
          agentModules={agent?.modules ?? null}
        />
      ) : (
        <div style={{ flex: 1 }} />
      )}
    </div>
  )
}
