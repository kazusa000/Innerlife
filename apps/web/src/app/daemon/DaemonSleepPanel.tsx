import styles from '../agent/[id]/manager-ui.module.css'
import type { DaemonSleepItem } from './types'

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

interface DaemonSleepPanelProps {
  agents: DaemonSleepItem[]
  sleepingAgentId: string | null
  onSleep: (agentId: string) => void
  locale: 'zh-CN' | 'en-US'
}

export function DaemonSleepPanel({ agents, sleepingAgentId, onSleep, locale }: DaemonSleepPanelProps) {
  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <div>
          <p className={styles.panelLabel}>{locale === 'en-US' ? 'Sleep' : '睡眠'}</p>
          <h3 className={styles.panelTitle}>STM → LTM</h3>
          <p className={styles.panelCopy}>
            {locale === 'en-US' ? 'Inspect recent sleep consolidation status and safely trigger one manual sleep run per agent.' : '查看最近睡眠沉淀状态，并按 agent 安全触发一次手动睡觉。'}
          </p>
        </div>
        <span className={styles.panelPill}>{locale === 'en-US' ? `${agents.length} agents` : `${agents.length} 个 agent`}</span>
      </div>

      {agents.length === 0 ? (
        <div className={styles.emptyState}>
          <p className={styles.emptyCopy}>{locale === 'en-US' ? 'No agents with sqlite memory enabled.' : '当前没有启用 sqlite memory 的 agent。'}</p>
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Agent</th>
                <th>{locale === 'en-US' ? 'Short-Term Memory' : '短期记忆'}</th>
                <th>{locale === 'en-US' ? 'Sleep Settings' : '睡眠设置'}</th>
                <th>{locale === 'en-US' ? 'Recent Sleep' : '最近睡眠'}</th>
                <th>{locale === 'en-US' ? 'Action' : '操作'}</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => (
                <tr key={agent.agentId}>
                  <td>
                    <span className={styles.tablePrimary}>{agent.agentName}</span>
                    <span className={styles.tableSecondary}>{agent.agentId}</span>
                  </td>
                  <td>
                    <span className={styles.tablePrimary}>{agent.shortTermCount}</span>
                    <span className={styles.tableSecondary}>{agent.canSleep ? (locale === 'en-US' ? 'Sleep window reached' : '已到睡眠窗口') : (locale === 'en-US' ? 'Not in sleep window' : '未到睡眠窗口')}</span>
                  </td>
                  <td>
                    <span className={styles.tablePrimary}>{agent.sleepEnabled ? (locale === 'en-US' ? 'Enabled' : '启用') : (locale === 'en-US' ? 'Off' : '关闭')}</span>
                    <span className={styles.tableSecondary}>{agent.sleepTimeLocal} / {locale === 'en-US' ? `every ${agent.sleepIntervalDays} days` : `每 ${agent.sleepIntervalDays} 天`}</span>
                  </td>
                  <td>
                    <span className={styles.tablePrimary}>{formatDate(agent.lastSleepAt, locale)}</span>
                    <span className={styles.tableSecondary}>{locale === 'en-US' ? 'Latest event' : '最近事件'}: {formatDate(agent.lastSleepEventAt, locale)}</span>
                  </td>
                  <td>
                    <button
                      className={styles.secondaryButton}
                      onClick={() => onSleep(agent.agentId)}
                      disabled={agent.shortTermCount === 0 || sleepingAgentId === agent.agentId}
                    >
                      {sleepingAgentId === agent.agentId ? (locale === 'en-US' ? 'Processing...' : '处理中…') : (locale === 'en-US' ? 'Sleep Now' : '立即睡觉')}
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
