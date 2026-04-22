'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { buildCreateRunRequest, resolveInitialJudgeConfig, type JudgeProvider } from './judge-config'
import styles from './TuringWorkbench.module.css'

type RunStatus =
  | 'queued'
  | 'preparing'
  | 'running'
  | 'interrupting'
  | 'interrupted'
  | 'completed'
  | 'failed'
  | 'cleaned'

interface DaemonState {
  id: string
  pid: number
  status: 'starting' | 'running' | 'stopping' | 'stopped'
  startedAt: string
  lastHeartbeatAt: string
  stoppedAt: string | null
  lastError: string | null
  updatedAt: string
}

interface TuringReport {
  verdict: 'pass' | 'fail'
  summary: string
  scores: {
    naturalness: number
    continuity: number
    recall: number
    emotion: number
    relationship: number
  }
  failures: string[]
  suggestions: string[]
  abort?: {
    stageId: string
    reason: string
    evidence: string
  } | null
}

interface TuringTranscriptTurn {
  stageId: string
  role: 'judge' | 'agent' | 'system'
  message: string
  createdAt: string
  meta?: Record<string, unknown>
}

interface TuringRun {
  id: string
  sourceAgentId: string
  sourceAgentName: string | null
  tempAgentId: string | null
  tempAgentName: string | null
  tempSessionId: string | null
  status: RunStatus
  currentStage: string | null
  abortReason: string | null
  judgeProvider: string | null
  judgeModel: string | null
  report: TuringReport | null
  transcript: TuringTranscriptTurn[] | null
  error: string | null
  createdAt: string
  updatedAt: string
  startedAt: string | null
  finishedAt: string | null
  cleanedAt: string | null
}

interface TuringEvent {
  id: string
  runId: string
  kind: string
  message: string
  payload: Record<string, unknown> | null
  createdAt: string
}

interface AgentSummary {
  id: string
  name: string
  provider: JudgeProvider
  model: string
}

const ACTIVE_STATUSES = new Set<RunStatus>(['queued', 'preparing', 'running', 'interrupting'])

const STAGE_LABELS: Record<string, string> = {
  natural_opening: '自然开场',
  daily_flow: '日常延续',
  memory_recall: '记忆追问',
  memory_humanness: '记忆拟人性',
  emotional_plausibility: '情绪合理性',
  relationship_boundaries: '关系边界',
  uncertainty_and_leaks: '不确定性与露馅处理',
}

const TIME_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

function formatDate(value: string | null) {
  if (!value) {
    return '无'
  }
  return TIME_FORMATTER.format(new Date(value))
}

function statusLabel(status: RunStatus | null | undefined) {
  switch (status) {
    case 'queued':
      return '排队中'
    case 'preparing':
      return '准备中'
    case 'running':
      return '运行中'
    case 'interrupting':
      return '正在中断'
    case 'interrupted':
      return '红线中断'
    case 'completed':
      return '已完成'
    case 'failed':
      return '运行失败'
    case 'cleaned':
      return '已清理'
    default:
      return '未开始'
  }
}

function roleLabel(role: TuringTranscriptTurn['role']) {
  if (role === 'judge') return '测试官'
  if (role === 'agent') return '被测 agent'
  return '系统'
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

export default function TuringWorkbench({ agentId }: { agentId: string }) {
  const [agent, setAgent] = useState<AgentSummary | null>(null)
  const [daemon, setDaemon] = useState<DaemonState | null>(null)
  const [runs, setRuns] = useState<TuringRun[]>([])
  const [currentRunId, setCurrentRunId] = useState<string | null>(null)
  const [currentRun, setCurrentRun] = useState<TuringRun | null>(null)
  const [events, setEvents] = useState<TuringEvent[]>([])
  const [judgeProvider, setJudgeProvider] = useState<JudgeProvider | null>(null)
  const [judgeModel, setJudgeModel] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const isActive = currentRun ? ACTIVE_STATUSES.has(currentRun.status) : false

  async function loadDaemon() {
    const response = await fetch('/api/turing/daemon', { cache: 'no-store' })
    const data = await response.json()
    if (!response.ok) {
      throw new Error(readErrorMessage(data, '加载 daemon 状态失败'))
    }
    setDaemon(data.daemon ?? null)
  }

  async function loadAgent() {
    const response = await fetch(`/api/agents/${agentId}`, { cache: 'no-store' })
    const data = await response.json()
    if (!response.ok) {
      throw new Error(readErrorMessage(data, '加载 persona 配置失败'))
    }

    const nextAgent = data as AgentSummary
    setAgent(nextAgent)
    const defaults = resolveInitialJudgeConfig({
      provider: nextAgent.provider,
      model: nextAgent.model,
    })
    setJudgeProvider((current) => current ?? defaults.judgeProvider)
    setJudgeModel((current) => current || defaults.judgeModel)
  }

  async function loadRuns(preferredRunId?: string | null) {
    const response = await fetch(`/api/turing/runs?sourceAgentId=${agentId}`, {
      cache: 'no-store',
    })
    const data = await response.json()
    if (!response.ok) {
      throw new Error(readErrorMessage(data, '加载图灵测试列表失败'))
    }
    const nextRuns = Array.isArray(data.runs) ? data.runs as TuringRun[] : []
    setRuns(nextRuns)
    const nextCurrentId = preferredRunId ?? currentRunId ?? nextRuns[0]?.id ?? null
    if (nextCurrentId) {
      setCurrentRunId(nextCurrentId)
    } else {
      setCurrentRun(null)
      setEvents([])
    }
  }

  async function loadRun(runId: string) {
    const response = await fetch(`/api/turing/runs/${runId}`, { cache: 'no-store' })
    const data = await response.json()
    if (!response.ok) {
      throw new Error(readErrorMessage(data, '加载图灵测试详情失败'))
    }
    setCurrentRun(data.run as TuringRun)
  }

  async function loadEvents(runId: string) {
    const response = await fetch(`/api/turing/runs/${runId}/events`, { cache: 'no-store' })
    const data = await response.json()
    if (!response.ok) {
      throw new Error(readErrorMessage(data, '加载图灵测试日志失败'))
    }
    setEvents(Array.isArray(data.events) ? data.events as TuringEvent[] : [])
  }

  async function refresh(preferredRunId?: string | null) {
    setLoading(true)
    setError(null)

    try {
      await Promise.all([
        loadAgent(),
        loadDaemon(),
        loadRuns(preferredRunId),
      ])
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载图灵测试工作台失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [agentId])

  useEffect(() => {
    if (!currentRunId) {
      return
    }
    void loadRun(currentRunId).catch((err) => {
      setError(err instanceof Error ? err.message : '加载图灵测试详情失败')
    })
    void loadEvents(currentRunId).catch((err) => {
      setError(err instanceof Error ? err.message : '加载图灵测试日志失败')
    })
  }, [currentRunId])

  useEffect(() => {
    if (!isActive) {
      return
    }

    const handle = window.setInterval(() => {
      void refresh(currentRunId)
      if (currentRunId) {
        void loadRun(currentRunId)
        void loadEvents(currentRunId)
      }
    }, 2500)

    return () => window.clearInterval(handle)
  }, [isActive, currentRunId])

  async function handleStart() {
    setError(null)
    setNotice(null)

    const response = await fetch('/api/turing/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildCreateRunRequest({
        sourceAgentId: agentId,
        judgeProvider,
        judgeModel,
      })),
    })
    const data = await response.json()
    if (!response.ok) {
      setError(readErrorMessage(data, '创建图灵测试任务失败'))
      return
    }

    const nextRun = data.run as TuringRun
    setNotice('图灵测试任务已创建，等待 daemon 处理。')
    setCurrentRunId(nextRun.id)
    startTransition(() => {
      void refresh(nextRun.id)
      void loadRun(nextRun.id)
      void loadEvents(nextRun.id)
    })
  }

  async function handleCleanup() {
    if (!currentRunId) {
      return
    }

    if (!window.confirm('要清理这次图灵测试产生的临时 agent、聊天、记忆和日志吗？')) {
      return
    }

    setError(null)
    setNotice(null)
    const response = await fetch(`/api/turing/runs/${currentRunId}/cleanup`, {
      method: 'POST',
    })
    const data = await response.json()
    if (!response.ok) {
      setError(readErrorMessage(data, '清理图灵测试数据失败'))
      return
    }

    setNotice('已清理本次图灵测试的临时数据。')
    startTransition(() => {
      void refresh(currentRunId)
      void loadRun(currentRunId)
      void loadEvents(currentRunId)
    })
  }

  const latestRun = useMemo(() => runs[0] ?? null, [runs])
  const report = currentRun?.report ?? null
  const transcript = currentRun?.transcript ?? []

  return (
    <div className={styles.workspace}>
      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>图灵测试系统</p>
          <h1 className={styles.title}>单次自动评测工作台</h1>
          <p className={styles.copy}>
            系统会复制当前 persona，强制开启全部模块，运行固定 7 段测试套件，并异步产出拟人感报告与完整对话回放。
          </p>
          <div className={styles.heroMeta}>
            <span className={styles.pill}>当前 persona：{agentId}</span>
            <span className={`${styles.pill} ${daemon?.status === 'running' ? '' : styles.pillWarn}`}>
              daemon：{daemon ? statusLabel(daemon.status as RunStatus) : '未启动'}
            </span>
            {latestRun && (
              <span className={`${styles.pill} ${latestRun.status === 'failed' ? styles.pillDanger : ''}`}>
                最近一次：{statusLabel(latestRun.status)}
              </span>
            )}
          </div>
        </div>

        <div className={styles.heroSide}>
          <div className={styles.configCard}>
            <p className={styles.sectionLabel}>测试官配置</p>
            <div className={styles.configGrid}>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Judge Provider</span>
                <select
                  className={styles.fieldControl}
                  value={judgeProvider ?? ''}
                  onChange={(event) => setJudgeProvider(event.target.value as JudgeProvider)}
                >
                  <option value="anthropic">anthropic</option>
                  <option value="openrouter">openrouter</option>
                </select>
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Judge Model</span>
                <input
                  className={styles.fieldControl}
                  value={judgeModel}
                  onChange={(event) => setJudgeModel(event.target.value)}
                  placeholder={agent?.model ?? '输入 judge model'}
                />
              </label>
            </div>
          </div>

          <div className={styles.heroActions}>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => void handleStart()}
            disabled={pending || isActive || !judgeProvider}
          >
            开始图灵测试
          </button>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => void refresh(currentRunId)}
            disabled={pending}
          >
            刷新状态
          </button>
          <button
            type="button"
            className={styles.dangerButton}
            onClick={() => void handleCleanup()}
            disabled={pending || !currentRunId}
          >
            清理本次测试
          </button>
          </div>
        </div>
      </section>

      {error && <section className={styles.emptyState}>{error}</section>}
      {notice && !error && <section className={styles.emptyState}>{notice}</section>}

      <section className={styles.panel}>
        <div className={styles.head}>
          <div>
            <p className={styles.sectionLabel}>运行历史</p>
            <h2 className={styles.panelTitle}>最近的测试任务</h2>
          </div>
        </div>
        {runs.length === 0 ? (
          <div className={styles.emptyState}>还没有图灵测试任务。先启动一次测试，daemon 会在后台异步执行。</div>
        ) : (
          <div className={styles.historyList}>
            {runs.map((run) => (
              <button
                key={run.id}
                type="button"
                className={`${styles.historyButton} ${currentRunId === run.id ? styles.historyButtonActive : ''}`}
                onClick={() => setCurrentRunId(run.id)}
              >
                <p className={styles.metricLabel}>{run.id.slice(0, 8)}</p>
                <p className={styles.metricText}>{statusLabel(run.status)} · {formatDate(run.createdAt)}</p>
                <p className={styles.runMeta}>
                  {run.currentStage ? `当前阶段：${STAGE_LABELS[run.currentStage] ?? run.currentStage}` : '等待或已完成'}
                </p>
              </button>
            ))}
          </div>
        )}
      </section>

      <div className={styles.topGrid}>
        <section className={styles.panel}>
          <div className={styles.head}>
            <div>
              <p className={styles.sectionLabel}>评测报告</p>
              <h2 className={styles.panelTitle}>拟人感结果</h2>
            </div>
            {currentRun && (
              <span className={`${styles.pill} ${currentRun.status === 'failed' ? styles.pillDanger : currentRun.status === 'interrupted' ? styles.pillWarn : ''}`}>
                {statusLabel(currentRun.status)}
              </span>
            )}
          </div>

          {!currentRun ? (
            <div className={styles.emptyState}>请选择一条测试任务。</div>
          ) : !report ? (
            <div className={styles.emptyState}>
              测试还在运行，或还没有生成报告。
              <br />
              临时测试 agent：{currentRun.tempAgentName ?? '尚未创建'}
            </div>
          ) : (
            <>
              <p className={styles.panelCopy}>{report.summary}</p>
              <div className={styles.reportGrid}>
                <article className={styles.metricCard}>
                  <p className={styles.metricLabel}>自然度</p>
                  <strong className={styles.metricValue}>{report.scores.naturalness.toFixed(1)}</strong>
                </article>
                <article className={styles.metricCard}>
                  <p className={styles.metricLabel}>连续性</p>
                  <strong className={styles.metricValue}>{report.scores.continuity.toFixed(1)}</strong>
                </article>
                <article className={styles.metricCard}>
                  <p className={styles.metricLabel}>回忆感</p>
                  <strong className={styles.metricValue}>{report.scores.recall.toFixed(1)}</strong>
                </article>
                <article className={styles.metricCard}>
                  <p className={styles.metricLabel}>情绪可信度</p>
                  <strong className={styles.metricValue}>{report.scores.emotion.toFixed(1)}</strong>
                </article>
                <article className={styles.metricCard}>
                  <p className={styles.metricLabel}>关系分寸感</p>
                  <strong className={styles.metricValue}>{report.scores.relationship.toFixed(1)}</strong>
                </article>
              </div>

              <div className={styles.metricCard}>
                <p className={styles.metricLabel}>关键失败点</p>
                {report.failures.length > 0 ? (
                  <ul className={styles.bulletList}>
                    {report.failures.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                ) : (
                  <p className={styles.metricText}>本次没有记录明确失败点。</p>
                )}
              </div>

              <div className={styles.metricCard}>
                <p className={styles.metricLabel}>立即修复建议</p>
                {report.suggestions.length > 0 ? (
                  <ul className={styles.bulletList}>
                    {report.suggestions.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                ) : (
                  <p className={styles.metricText}>本次没有额外建议。</p>
                )}
              </div>

              {report.abort && (
                <div className={styles.metricCard}>
                  <p className={styles.metricLabel}>红线中断</p>
                  <p className={styles.metricText}>阶段：{STAGE_LABELS[report.abort.stageId] ?? report.abort.stageId}</p>
                  <p className={styles.metricText}>原因：{report.abort.reason}</p>
                  <p className={styles.metricText}>证据：{report.abort.evidence}</p>
                </div>
              )}
            </>
          )}
        </section>

        <section className={styles.panel}>
          <div className={styles.head}>
            <div>
              <p className={styles.sectionLabel}>后台命令行状态</p>
              <h2 className={styles.panelTitle}>Judge Runner 控制台</h2>
            </div>
            {currentRun?.tempSessionId && (
              <a className={styles.linkButton} href={`/chat?agent=${currentRun.tempAgentId ?? agentId}`}>
                打开临时聊天
              </a>
            )}
          </div>
          <div className={styles.console}>
            {events.length === 0 ? (
              <div className={styles.lineSubtle}>暂无后台日志。</div>
            ) : (
              events.map((event) => (
                <div key={event.id} className={styles.consoleLine}>
                  <span className={styles.consoleTime}>{formatDate(event.createdAt)}</span>
                  <span className={styles.consoleKind}>{event.kind}</span>
                  <span>{event.message}</span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      <section className={styles.panel}>
        <div className={styles.head}>
          <div>
            <p className={styles.sectionLabel}>完整回放</p>
            <h2 className={styles.panelTitle}>测试官与被测 agent 对话</h2>
          </div>
        </div>
        {!currentRun ? (
          <div className={styles.emptyState}>还没有可查看的测试回放。</div>
        ) : transcript.length === 0 ? (
          <div className={styles.emptyState}>当前任务还没有 transcript。</div>
        ) : (
          <div className={styles.transcript}>
            {transcript.map((turn, index) => (
              <article key={`${turn.createdAt}-${index}`} className={styles.transcriptItem}>
                <div className={styles.transcriptHead}>
                  <span
                    className={`${styles.rolePill} ${
                      turn.role === 'judge'
                        ? styles.roleJudge
                        : turn.role === 'agent'
                          ? styles.roleAgent
                          : styles.roleSystem
                    }`}
                  >
                    {roleLabel(turn.role)}
                  </span>
                  <span className={styles.lineSubtle}>
                    {STAGE_LABELS[turn.stageId] ?? turn.stageId} · {formatDate(turn.createdAt)}
                  </span>
                </div>
                <p className={styles.transcriptMessage}>{turn.message}</p>
              </article>
            ))}
          </div>
        )}
      </section>

      {loading && runs.length === 0 && <div className={styles.emptyState}>正在加载图灵测试工作台…</div>}
    </div>
  )
}
