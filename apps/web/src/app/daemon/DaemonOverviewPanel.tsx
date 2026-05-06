import styles from '../agent/[id]/manager-ui.module.css'
import localStyles from './DaemonWorkbench.module.css'
import type { DaemonOverviewData } from './types'
import { getDaemonHeadline } from './daemon-view-model'

function formatDate(value: string | null, locale: 'zh-CN' | 'en-US') {
  if (!value) {
    return locale === 'en-US' ? 'None' : '无'
  }

  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

export function DaemonOverviewPanel({ daemon, tickIntervalMs, recentEventCounts, locale }: DaemonOverviewData & { locale: 'zh-CN' | 'en-US' }) {
  const online = daemon?.status === 'running'

  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <div>
          <p className={styles.panelLabel}>{locale === 'en-US' ? 'Overview' : '概览'}</p>
          <h3 className={styles.panelTitle}>{getDaemonHeadline(daemon, locale)}</h3>
          <p className={styles.panelCopy}>
            {locale === 'en-US'
              ? 'This summarizes daemon heartbeat, errors, and recent background events.'
              : '这里集中显示 daemon 本体的心跳、错误与最近后台事件摘要。'}
          </p>
        </div>
        <span className={styles.panelPill}>{online ? (locale === 'en-US' ? 'Online' : '在线') : (locale === 'en-US' ? 'Offline' : '离线')}</span>
      </div>

      <div className={styles.metricList}>
        <div>
          <dt>{locale === 'en-US' ? 'Status' : '状态'}</dt>
          <dd className={online ? localStyles.statusOnline : localStyles.statusOffline}>
            {daemon ? daemon.status : 'offline'}
          </dd>
        </div>
        <div>
          <dt>PID</dt>
          <dd>{daemon?.pid ?? (locale === 'en-US' ? 'None' : '无')}</dd>
        </div>
        <div>
          <dt>{locale === 'en-US' ? 'Tick Interval' : 'Tick 间隔'}</dt>
          <dd>{tickIntervalMs}ms</dd>
        </div>
        <div>
          <dt>{locale === 'en-US' ? 'Last Heartbeat' : '最后心跳'}</dt>
          <dd>{formatDate(daemon?.lastHeartbeatAt ?? null, locale)}</dd>
        </div>
        <div>
          <dt>{locale === 'en-US' ? 'Total Events' : '总事件数'}</dt>
          <dd>{recentEventCounts.total}</dd>
        </div>
        <div>
          <dt>{locale === 'en-US' ? 'Latest Error' : '最近错误'}</dt>
          <dd>{daemon?.lastError ?? (locale === 'en-US' ? 'None' : '无')}</dd>
        </div>
      </div>

      <dl className={styles.metricList}>
        <div>
          <dt>Daemon</dt>
          <dd>{recentEventCounts.daemon}</dd>
        </div>
        <div>
          <dt>{locale === 'en-US' ? 'Memory Flush' : '记忆 Flush'}</dt>
          <dd>{recentEventCounts.memoryFlush}</dd>
        </div>
        <div>
          <dt>{locale === 'en-US' ? 'Sleep' : '睡眠'}</dt>
          <dd>{recentEventCounts.memorySleep}</dd>
        </div>
      </dl>
    </section>
  )
}
