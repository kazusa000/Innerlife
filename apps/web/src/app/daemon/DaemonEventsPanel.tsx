import styles from '../agent/[id]/manager-ui.module.css'
import localStyles from './DaemonWorkbench.module.css'
import type { DaemonEventView } from './types'
import { formatDaemonEventLine } from './daemon-view-model'

interface DaemonEventsPanelProps {
  events: DaemonEventView[]
}

export function DaemonEventsPanel({ events }: DaemonEventsPanelProps) {
  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <div>
          <p className={styles.panelLabel}>事件流</p>
          <h3 className={styles.panelTitle}>后台命令行状态台</h3>
          <p className={styles.panelCopy}>
            这是 daemon 的只读事件快照，不是可输入终端。
          </p>
        </div>
        <span className={styles.panelPill}>{events.length} 条</span>
      </div>

      {events.length === 0 ? (
        <div className={styles.emptyState}>
          <p className={styles.emptyCopy}>还没有 daemon 事件。</p>
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
