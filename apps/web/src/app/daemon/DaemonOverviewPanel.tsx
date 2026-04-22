import styles from '../agent/[id]/manager-ui.module.css'
import localStyles from './DaemonWorkbench.module.css'
import type { DaemonOverviewData } from './types'
import { getDaemonHeadline } from './daemon-view-model'

function formatDate(value: string | null) {
  if (!value) {
    return '无'
  }

  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

export function DaemonOverviewPanel({ daemon, tickIntervalMs, recentEventCounts }: DaemonOverviewData) {
  const online = daemon?.status === 'running'

  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <div>
          <p className={styles.panelLabel}>概览</p>
          <h3 className={styles.panelTitle}>{getDaemonHeadline(daemon)}</h3>
          <p className={styles.panelCopy}>
            这里集中显示 daemon 本体的心跳、错误与最近后台事件摘要。
          </p>
        </div>
        <span className={styles.panelPill}>{online ? '在线' : '离线'}</span>
      </div>

      <div className={styles.metricList}>
        <div>
          <dt>状态</dt>
          <dd className={online ? localStyles.statusOnline : localStyles.statusOffline}>
            {daemon ? daemon.status : 'offline'}
          </dd>
        </div>
        <div>
          <dt>PID</dt>
          <dd>{daemon?.pid ?? '无'}</dd>
        </div>
        <div>
          <dt>Tick 间隔</dt>
          <dd>{tickIntervalMs}ms</dd>
        </div>
        <div>
          <dt>最后心跳</dt>
          <dd>{formatDate(daemon?.lastHeartbeatAt ?? null)}</dd>
        </div>
        <div>
          <dt>总事件数</dt>
          <dd>{recentEventCounts.total}</dd>
        </div>
        <div>
          <dt>最近错误</dt>
          <dd>{daemon?.lastError ?? '无'}</dd>
        </div>
      </div>

      <dl className={styles.metricList}>
        <div>
          <dt>Daemon</dt>
          <dd>{recentEventCounts.daemon}</dd>
        </div>
        <div>
          <dt>图灵测试</dt>
          <dd>{recentEventCounts.turing}</dd>
        </div>
        <div>
          <dt>记忆 Flush</dt>
          <dd>{recentEventCounts.memoryFlush}</dd>
        </div>
        <div>
          <dt>睡眠</dt>
          <dd>{recentEventCounts.memorySleep}</dd>
        </div>
      </dl>
    </section>
  )
}
