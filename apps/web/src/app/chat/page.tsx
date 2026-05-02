'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ChatArea } from './ChatArea'
import { Sidebar } from './Sidebar'
import { getPersonalityAvatarUrl } from '../persona-modules'
import type { AgentModules } from './observer-types'
import {
  buildContextResetNotice,
  buildContextResetRequestBody,
  type ContextResetMode,
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
  const [resettingMode, setResettingMode] = useState<ContextResetMode | null>(null)
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

  async function handleResetContext(mode: ContextResetMode) {
    if (!agentId || isResettingContext) {
      return
    }

    setIsResettingContext(true)
    setResettingMode(mode)
    setResetNotice(null)
    try {
      const sessionRes = await fetch(`/api/agents/${agentId}/active-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildContextResetRequestBody(mode, memoryScheme)),
      })
      const body = await sessionRes.json().catch(() => null)

      if (!sessionRes.ok) {
        setResetNotice(buildContextResetNotice({
          mode,
          memoryScheme,
          responseOk: false,
          responseError: readErrorMessage(body, '清除上下文失败，请稍后再试。'),
        }))
        return
      }

      const sessionData = body as ContextResetResponse
      setCurrentId(sessionData.session.id)
      setResetNotice(buildContextResetNotice({
        mode,
        memoryScheme,
        responseOk: true,
        contextFlush: sessionData.contextFlush,
      }))
    } catch {
      setResetNotice(buildContextResetNotice({
        mode,
        memoryScheme,
        responseOk: false,
        responseError: '清除上下文失败，请稍后再试。',
      }))
    } finally {
      setIsResettingContext(false)
      setResettingMode(null)
    }
  }

  return (
    <div className="chat-shell">
      <Sidebar
        agentId={agent?.id}
        sessionId={currentId}
        memoryScheme={memoryScheme}
        relationshipScheme={typeof agent?.modules?.relationship?.scheme === 'string' ? agent.modules.relationship.scheme : null}
        agentName={agent?.name}
        onBack={() => router.push('/')}
        onResetContext={handleResetContext}
        isResetting={isResettingContext}
        resettingMode={resettingMode}
        resetNotice={resetNotice}
        agentAvatarUrl={getPersonalityAvatarUrl(agent?.modules)}
      />
      {loaded && currentId ? (
        <ChatArea
          key={currentId}
          sessionId={currentId}
          agentModules={agent?.modules ?? null}
          agentName={agent?.name}
          agentAvatarUrl={getPersonalityAvatarUrl(agent?.modules)}
        />
      ) : (
        <div style={{ flex: 1 }} />
      )}

      <style jsx>{`
        .chat-shell {
          display: flex;
          height: 100vh;
          position: relative;
          overflow: hidden;
          background:
            linear-gradient(90deg, rgba(4, 7, 15, 0.96), rgba(4, 7, 15, 0.72) 36%, rgba(4, 7, 15, 0.92)),
            url('/workbench-assets/chat-console-bg.png') center / cover no-repeat,
            #03060d;
        }

        .chat-shell::before {
          content: '';
          position: absolute;
          inset: 0;
          pointer-events: none;
          background:
            radial-gradient(circle at 74% 18%, rgba(20, 184, 166, 0.12), transparent 34%),
            radial-gradient(circle at 28% 84%, rgba(245, 158, 11, 0.08), transparent 32%);
          z-index: 0;
        }

        .chat-shell > :global(*) {
          position: relative;
          z-index: 1;
        }
      `}</style>
    </div>
  )
}
