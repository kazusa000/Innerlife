'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ChatArea } from './ChatArea'
import { Sidebar } from './Sidebar'
import type { AgentModules } from './observer-types'
import {
  buildContextResetNotice,
  buildContextResetRequestBody,
  type ContextResetNotice,
  type ContextResetResponse,
} from './context-reset'

interface Agent {
  id: string
  name: string
  provider: 'anthropic' | 'openrouter'
  model: string
  modules: AgentModules | null
}

function readErrorMessage(value: unknown, fallback: string) {
  if (
    value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && 'error' in value
    && typeof value.error === 'string'
  ) {
    return value.error
  }

  return fallback
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
  const [resetNotice, setResetNotice] = useState<ContextResetNotice | null>(null)
  const memoryScheme = typeof agent?.modules?.memory?.scheme === 'string'
    ? agent.modules.memory.scheme
    : null

  useEffect(() => {
    let cancelled = false

    async function loadChatContext() {
      setLoaded(false)
      setAgent(null)
      setCurrentId(null)
      setResetNotice(null)

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
    setResetNotice(null)
    try {
      const sessionRes = await fetch(`/api/agents/${agentId}/active-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildContextResetRequestBody(memoryScheme)),
      })
      const body = await sessionRes.json().catch(() => null)

      if (!sessionRes.ok) {
        setResetNotice(buildContextResetNotice({
          memoryScheme,
          responseOk: false,
          responseError: readErrorMessage(body, '清除上下文失败，请稍后再试。'),
        }))
        return
      }

      const sessionData = body as ContextResetResponse
      setCurrentId(sessionData.session.id)
      setResetNotice(buildContextResetNotice({
        memoryScheme,
        responseOk: true,
        contextFlush: sessionData.contextFlush,
      }))
    } catch {
      setResetNotice(buildContextResetNotice({
        memoryScheme,
        responseOk: false,
        responseError: '清除上下文失败，请稍后再试。',
      }))
    } finally {
      setIsResettingContext(false)
    }
  }

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <Sidebar
        agentId={agent?.id}
        sessionId={currentId}
        memoryScheme={memoryScheme}
        relationshipScheme={typeof agent?.modules?.relationship?.scheme === 'string' ? agent.modules.relationship.scheme : null}
        agentName={agent?.name}
        onBack={() => router.push('/')}
        onResetContext={handleResetContext}
        isResetting={isResettingContext}
        resetNotice={resetNotice}
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
