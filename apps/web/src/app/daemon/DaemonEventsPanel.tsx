import styles from '../agent/[id]/manager-ui.module.css'
import localStyles from './DaemonWorkbench.module.css'
import type { DaemonEventView } from './types'
import { formatDaemonEventLine } from './daemon-view-model'

interface DaemonEventsPanelProps {
  events: DaemonEventView[]
  locale: 'zh-CN' | 'en-US'
}

export function DaemonEventsPanel({ events, locale }: DaemonEventsPanelProps) {
  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <div>
          <p className={styles.panelLabel}>{locale === 'en-US' ? 'Event Stream' : '事件流'}</p>
          <h3 className={styles.panelTitle}>{locale === 'en-US' ? 'Background Command Console' : '后台命令行状态台'}</h3>
          <p className={styles.panelCopy}>
            {locale === 'en-US' ? 'This is a read-only daemon event snapshot, not an interactive terminal.' : '这是 daemon 的只读事件快照，不是可输入终端。'}
          </p>
        </div>
        <span className={styles.panelPill}>{locale === 'en-US' ? `${events.length} events` : `${events.length} 条`}</span>
      </div>

      {events.length === 0 ? (
        <div className={styles.emptyState}>
          <p className={styles.emptyCopy}>{locale === 'en-US' ? 'No daemon events yet.' : '还没有 daemon 事件。'}</p>
        </div>
      ) : (
        <pre className={localStyles.console}>
          {events.map((event) => (
            <span key={event.id} className={localStyles.consoleLine}>
              {formatDaemonEventLine(event)}
            </span>
          ))}
        </pre>
      )}
    </section>
  )
}
