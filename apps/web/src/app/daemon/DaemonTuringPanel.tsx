import styles from '../agent/[id]/manager-ui.module.css'
import localStyles from './DaemonWorkbench.module.css'
import type { DaemonTuringRunView } from './types'

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

interface DaemonTuringPanelProps {
  runs: DaemonTuringRunView[]
  locale: 'zh-CN' | 'en-US'
}

export function DaemonTuringPanel({ runs, locale }: DaemonTuringPanelProps) {
  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <div>
          <p className={styles.panelLabel}>{locale === 'en-US' ? 'Turing Tests' : '图灵测试'}</p>
          <h3 className={styles.panelTitle}>{locale === 'en-US' ? 'Recent Runs' : '最近 run'}</h3>
          <p className={styles.panelCopy}>
            {locale === 'en-US' ? 'Inspect recent async Turing test jobs and jump to the matching persona test page.' : '查看最近的异步图灵测试任务，并跳转到对应 persona 的图灵测试页。'}
          </p>
        </div>
        <span className={styles.panelPill}>{locale === 'en-US' ? `${runs.length} runs` : `${runs.length} 条`}</span>
      </div>

      {runs.length === 0 ? (
        <div className={styles.emptyState}>
          <p className={styles.emptyCopy}>{locale === 'en-US' ? 'No Turing test jobs yet.' : '还没有图灵测试任务。'}</p>
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Persona</th>
                <th>{locale === 'en-US' ? 'Status' : '状态'}</th>
                <th>{locale === 'en-US' ? 'Stage' : '阶段'}</th>
                <th>{locale === 'en-US' ? 'Updated' : '更新时间'}</th>
                <th>{locale === 'en-US' ? 'Action' : '操作'}</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id}>
                  <td>
                    <span className={styles.tablePrimary}>{run.sourceAgentName ?? run.sourceAgentId}</span>
                    <span className={styles.tableSecondary}>{run.id}</span>
                  </td>
                  <td className={styles.tablePrimary}>{run.status}</td>
                  <td className={styles.tableSecondary}>{run.currentStage ?? (locale === 'en-US' ? 'None' : '无')}</td>
                  <td className={styles.tableSecondary}>{formatDate(run.updatedAt, locale)}</td>
                  <td>
                    <a
                      href={`/agent/${run.sourceAgentId}/turing`}
                      className={localStyles.linkButton}
                    >
                      {locale === 'en-US' ? 'Open' : '打开'}
                    </a>
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
