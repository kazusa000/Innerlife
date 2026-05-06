import styles from '../agent/[id]/manager-ui.module.css'
import type { DaemonContextFlushItem } from './types'

function formatDate(value: string | null, locale: 'zh-CN' | 'en-US') {
  if (!value) {
    return locale === 'en-US' ? 'None' : '无'
  }

  return new Intl.DateTimeFormat(locale, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

interface DaemonContextFlushPanelProps {
  sessions: DaemonContextFlushItem[]
  flushingSessionId: string | null
  onFlush: (sessionId: string) => void
  locale: 'zh-CN' | 'en-US'
}

export function DaemonContextFlushPanel({
  sessions,
  flushingSessionId,
  onFlush,
  locale,
}: DaemonContextFlushPanelProps) {
  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <div>
          <p className={styles.panelLabel}>{locale === 'en-US' ? 'Memory Flush' : '记忆 Flush'}</p>
          <h3 className={styles.panelTitle}>Context → STM</h3>
          <p className={styles.panelCopy}>
            {locale === 'en-US' ? 'Inspect active-session context candidates and safely trigger a manual flush when needed.' : '检查当前活跃 session 的 context 候选，并在需要时安全触发一次手动 flush。'}
          </p>
        </div>
        <span className={styles.panelPill}>{locale === 'en-US' ? `${sessions.length} sessions` : `${sessions.length} 个 session`}</span>
      </div>

      {sessions.length === 0 ? (
        <div className={styles.emptyState}>
          <p className={styles.emptyCopy}>{locale === 'en-US' ? 'No active sessions with sqlite memory enabled.' : '当前没有启用 sqlite memory 的活跃 session。'}</p>
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Session</th>
                <th>{locale === 'en-US' ? 'Active Context' : '活跃上下文'}</th>
                <th>{locale === 'en-US' ? 'Recent Activity' : '最近活动'}</th>
                <th>{locale === 'en-US' ? 'Can Flush' : '可 Flush'}</th>
                <th>{locale === 'en-US' ? 'Action' : '操作'}</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => (
                <tr key={session.sessionId}>
                  <td>
                    <span className={styles.tablePrimary}>{session.agentName}</span>
                    <span className={styles.tableSecondary}>{session.sessionTitle ?? session.sessionId}</span>
                  </td>
                  <td>
                    <span className={styles.tablePrimary}>{session.activeMessageCount} / {session.totalSessionMessages}</span>
                    <span className={styles.tableSecondary}>{session.activeStartMessageId ?? (locale === 'en-US' ? 'No start point set' : '未设置起点')}</span>
                  </td>
                  <td>
                    <span className={styles.tablePrimary}>{formatDate(session.lastUserMessageAt, locale)}</span>
                    <span className={styles.tableSecondary}>{locale === 'en-US' ? 'Last flush' : '上次 flush'}: {formatDate(session.lastContextFlushAt, locale)}</span>
                  </td>
                  <td>
                    <span className={styles.tablePrimary}>{session.canFlush ? (locale === 'en-US' ? 'Yes' : '是') : (locale === 'en-US' ? 'No' : '否')}</span>
                    <span className={styles.tableSecondary}>{session.flushReason ?? (locale === 'en-US' ? 'None' : '无')}</span>
                  </td>
                  <td>
                    <button
                      className={styles.secondaryButton}
                      onClick={() => onFlush(session.sessionId)}
                      disabled={!session.canFlush || flushingSessionId === session.sessionId}
                    >
                      {flushingSessionId === session.sessionId ? (locale === 'en-US' ? 'Processing...' : '处理中…') : (locale === 'en-US' ? 'Flush Now' : '立即 flush')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
