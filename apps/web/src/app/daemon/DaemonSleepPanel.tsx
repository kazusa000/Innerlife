import styles from '../agent/[id]/manager-ui.module.css'
import type { DaemonSleepItem } from './types'

function formatDate(value: string | null) {
  if (!value) {
    return '无'
  }

  return new Intl.DateTimeFormat('zh-CN', {
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
}

export function DaemonSleepPanel({ agents, sleepingAgentId, onSleep }: DaemonSleepPanelProps) {
  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <div>
          <p className={styles.panelLabel}>睡眠</p>
          <h3 className={styles.panelTitle}>STM → LTM</h3>
          <p className={styles.panelCopy}>
            查看最近睡眠沉淀状态，并按 agent 安全触发一次手动睡觉。
          </p>
        </div>
        <span className={styles.panelPill}>{agents.length} 个 agent</span>
      </div>

      {agents.length === 0 ? (
        <div className={styles.emptyState}>
          <p className={styles.emptyCopy}>当前没有启用 sqlite memory 的 agent。</p>
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Agent</th>
                <th>短期记忆</th>
                <th>睡眠设置</th>
                <th>最近睡眠</th>
                <th>操作</th>
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
                    <span className={styles.tableSecondary}>{agent.canSleep ? '已到睡眠窗口' : '未到睡眠窗口'}</span>
                  </td>
                  <td>
                    <span className={styles.tablePrimary}>{agent.sleepEnabled ? '启用' : '关闭'}</span>
                    <span className={styles.tableSecondary}>{agent.sleepTimeLocal} / 每 {agent.sleepIntervalDays} 天</span>
                  </td>
                  <td>
                    <span className={styles.tablePrimary}>{formatDate(agent.lastSleepAt)}</span>
                    <span className={styles.tableSecondary}>最近事件：{formatDate(agent.lastSleepEventAt)}</span>
                  </td>
                  <td>
                    <button
                      className={styles.secondaryButton}
                      onClick={() => onSleep(agent.agentId)}
                      disabled={agent.shortTermCount === 0 || sleepingAgentId === agent.agentId}
                    >
                      {sleepingAgentId === agent.agentId ? '处理中…' : '立即睡觉'}
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
