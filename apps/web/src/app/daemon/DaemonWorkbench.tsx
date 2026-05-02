'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import styles from '../agent/[id]/manager-ui.module.css'
import { DaemonContextFlushPanel } from './DaemonContextFlushPanel'
import { DaemonEventsPanel } from './DaemonEventsPanel'
import { DaemonOverviewPanel } from './DaemonOverviewPanel'
import { DaemonSectionNav } from './DaemonSectionNav'
import { getDaemonSections, type DaemonSectionId } from './daemon-sections'
import { DaemonSleepPanel } from './DaemonSleepPanel'
import { DaemonTuringPanel } from './DaemonTuringPanel'
import type {
  DaemonContextFlushItem,
  DaemonEventView,
  DaemonOverviewData,
  DaemonSleepItem,
  DaemonTuringRunView,
} from './types'

const DEFAULT_OVERVIEW: DaemonOverviewData = {
  daemon: null,
  tickIntervalMs: 5000,
  recentEventCounts: {
    total: 0,
    daemon: 0,
    turing: 0,
    memoryFlush: 0,
    memorySleep: 0,
  },
}

const SECTIONS = getDaemonSections()

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

export default function DaemonWorkbench() {
  const [overview, setOverview] = useState<DaemonOverviewData>(DEFAULT_OVERVIEW)
  const [runs, setRuns] = useState<DaemonTuringRunView[]>([])
  const [flushSessions, setFlushSessions] = useState<DaemonContextFlushItem[]>([])
  const [sleepAgents, setSleepAgents] = useState<DaemonSleepItem[]>([])
  const [events, setEvents] = useState<DaemonEventView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [flushingSessionId, setFlushingSessionId] = useState<string | null>(null)
  const [sleepingAgentId, setSleepingAgentId] = useState<string | null>(null)
  const [activeSection, setActiveSection] = useState<DaemonSectionId>('overview')
  const [pending, startTransition] = useTransition()
  const sectionRefs = useRef<Record<DaemonSectionId, HTMLElement | null>>({
    overview: null,
    turing: null,
    flush: null,
    sleep: null,
    events: null,
  })

  async function refresh() {
    setError(null)

    try {
      const [overviewResponse, runResponse, flushResponse, sleepResponse, eventResponse] = await Promise.all([
        fetch('/api/daemon', { cache: 'no-store' }),
        fetch('/api/daemon/turing-runs', { cache: 'no-store' }),
        fetch('/api/daemon/context-flush', { cache: 'no-store' }),
        fetch('/api/daemon/sleep', { cache: 'no-store' }),
        fetch('/api/daemon/events', { cache: 'no-store' }),
      ])

      const [overviewPayload, runPayload, flushPayload, sleepPayload, eventPayload] = await Promise.all([
        overviewResponse.json() as Promise<unknown>,
        runResponse.json() as Promise<unknown>,
        flushResponse.json() as Promise<unknown>,
        sleepResponse.json() as Promise<unknown>,
        eventResponse.json() as Promise<unknown>,
      ])

      if (!overviewResponse.ok) throw new Error(readErrorMessage(overviewPayload, '加载 daemon 概览失败'))
      if (!runResponse.ok) throw new Error(readErrorMessage(runPayload, '加载图灵测试列表失败'))
      if (!flushResponse.ok) throw new Error(readErrorMessage(flushPayload, '加载 flush 列表失败'))
      if (!sleepResponse.ok) throw new Error(readErrorMessage(sleepPayload, '加载睡眠列表失败'))
      if (!eventResponse.ok) throw new Error(readErrorMessage(eventPayload, '加载事件流失败'))

      const overviewData = overviewPayload as { daemon: DaemonOverviewData['daemon']; tickIntervalMs: number; recentEventCounts: DaemonOverviewData['recentEventCounts'] }
      const runData = runPayload as { runs: DaemonTuringRunView[] }
      const flushData = flushPayload as { sessions: DaemonContextFlushItem[] }
      const sleepData = sleepPayload as { agents: DaemonSleepItem[] }
      const eventData = eventPayload as { events: DaemonEventView[] }

      setOverview({
        daemon: overviewData.daemon ?? null,
        tickIntervalMs: overviewData.tickIntervalMs ?? 5000,
        recentEventCounts: overviewData.recentEventCounts ?? DEFAULT_OVERVIEW.recentEventCounts,
      })
      setRuns(Array.isArray(runData.runs) ? runData.runs : [])
      setFlushSessions(Array.isArray(flushData.sessions) ? flushData.sessions : [])
      setSleepAgents(Array.isArray(sleepData.agents) ? sleepData.agents : [])
      setEvents(Array.isArray(eventData.events) ? eventData.events : [])
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '加载 daemon 工作台失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
    const interval = setInterval(() => {
      void refresh()
    }, 5000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0]
        if (!visible) {
          return
        }

        const sectionId = visible.target.getAttribute('data-section-id') as DaemonSectionId | null
        if (sectionId) {
          setActiveSection(sectionId)
        }
      },
      {
        rootMargin: '-20% 0px -55% 0px',
        threshold: [0.15, 0.35, 0.55],
      },
    )

    for (const section of SECTIONS) {
      const element = sectionRefs.current[section.id]
      if (element) {
        observer.observe(element)
      }
    }

    return () => observer.disconnect()
  }, [])

  function registerSection(id: DaemonSectionId) {
    return (element: HTMLElement | null) => {
      sectionRefs.current[id] = element
    }
  }

  function showNotice(message: string) {
    setNotice(message)
    window.setTimeout(() => setNotice(null), 3000)
  }

  async function handleFlush(sessionId: string) {
    setFlushingSessionId(sessionId)
    setError(null)
    try {
      const response = await fetch('/api/daemon/context-flush', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      })
      const data = await response.json() as unknown
      if (!response.ok) {
        throw new Error(readErrorMessage(data, '执行 flush 失败'))
      }
      if (
        data
        && typeof data === 'object'
        && !Array.isArray(data)
        && 'result' in data
        && data.result
        && typeof data.result === 'object'
        && !Array.isArray(data.result)
        && 'ok' in data.result
        && data.result.ok === false
      ) {
        const reason = 'reason' in data.result && typeof data.result.reason === 'string'
          ? data.result.reason
          : 'flush 未执行'
        throw new Error(reason)
      }
      showNotice('已触发一次手动 flush。')
      await refresh()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '执行 flush 失败')
    } finally {
      setFlushingSessionId(null)
    }
  }

  async function handleSleep(agentId: string) {
    setSleepingAgentId(agentId)
    setError(null)
    try {
      const response = await fetch('/api/daemon/sleep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId }),
      })
      const data = await response.json() as unknown
      if (!response.ok) {
        throw new Error(readErrorMessage(data, '执行睡眠失败'))
      }
      if (
        data
        && typeof data === 'object'
        && !Array.isArray(data)
        && 'result' in data
        && data.result
        && typeof data.result === 'object'
        && !Array.isArray(data.result)
        && 'ok' in data.result
        && data.result.ok === false
      ) {
        const reason = 'reason' in data.result && typeof data.result.reason === 'string'
          ? data.result.reason
          : '睡眠未执行'
        throw new Error(reason)
      }
      showNotice('已触发一次手动睡觉。')
      await refresh()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '执行睡眠失败')
    } finally {
      setSleepingAgentId(null)
    }
  }

  return (
    <main className={`${styles.workspace} daemon-workbench`}>
      <header className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>后台系统</p>
          <h1 className={styles.title}>Daemon Workbench</h1>
          <p className={styles.copy}>
            从全局视角观察 daemon、图灵测试任务、context flush、睡眠沉淀和后台事件流。
          </p>
        </div>
        <div className={styles.heroActions}>
          <button
            className={styles.secondaryButton}
            onClick={() => startTransition(() => { void refresh() })}
            disabled={pending || loading}
          >
            {loading ? '加载中…' : '刷新'}
          </button>
        </div>
      </header>

      {error ? <p className={styles.error}>{error}</p> : null}
      {notice ? <p className={styles.notice}>{notice}</p> : null}

      <div className={styles.sectionLayout}>
          <DaemonSectionNav activeSection={activeSection} />

        <div className={styles.contentStack}>
          <div
            id="daemon-section-overview"
            data-section-id="overview"
            ref={registerSection('overview')}
            className={styles.sectionPanel}
          >
            <DaemonOverviewPanel {...overview} />
          </div>

          <div
            id="daemon-section-events"
            data-section-id="events"
            ref={registerSection('events')}
            className={styles.sectionPanel}
          >
            <DaemonEventsPanel events={events} />
          </div>

          <div
            id="daemon-section-turing"
            data-section-id="turing"
            ref={registerSection('turing')}
            className={styles.sectionPanel}
          >
            <DaemonTuringPanel runs={runs} />
          </div>

          <div
            id="daemon-section-flush"
            data-section-id="flush"
            ref={registerSection('flush')}
            className={styles.sectionPanel}
          >
            <DaemonContextFlushPanel
              sessions={flushSessions}
              flushingSessionId={flushingSessionId}
              onFlush={handleFlush}
            />
          </div>

          <div
            id="daemon-section-sleep"
            data-section-id="sleep"
            ref={registerSection('sleep')}
            className={styles.sectionPanel}
          >
            <DaemonSleepPanel
              agents={sleepAgents}
              sleepingAgentId={sleepingAgentId}
              onSleep={handleSleep}
            />
          </div>
        </div>
      </div>
    </main>
  )
}
