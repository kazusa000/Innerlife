'use client'

import styles from '../agent/[id]/manager-ui.module.css'
import localStyles from './DaemonWorkbench.module.css'
import { getDaemonNavGroups, type DaemonSectionId } from './daemon-sections'

interface DaemonSectionNavProps {
  activeSection: DaemonSectionId
  locale: 'zh-CN' | 'en-US'
}

export function DaemonSectionNav({ activeSection, locale }: DaemonSectionNavProps) {
  const navGroups = getDaemonNavGroups(locale)
  return (
    <aside className={styles.sideNav}>
      <div className={styles.sideNavHead}>
        <p className={styles.eyebrow}>{locale === 'en-US' ? 'Background Console' : '后台控制台'}</p>
        <h2 className={styles.sideNavTitle}>Daemon Workbench</h2>
        <p className={styles.sideNavCopy}>
          {locale === 'en-US'
            ? 'Inspect the daemon, Turing test runs, memory flushes, sleep consolidation, and recent background events.'
            : '查看 daemon 本体、图灵测试 run、记忆 flush、睡眠沉淀和最近后台事件。'}
        </p>
      </div>

      <nav className={styles.sideNavList} aria-label="Daemon sections">
        {navGroups.map((group) => {
          if (group.id !== 'features') {
            return (
              <a
                key={group.id}
                href={`#${group.anchor}`}
                className={`${styles.sideNavLink} ${activeSection === group.id ? styles.sideNavLinkActive : ''}`}
              >
                <span className={styles.sideNavLabel}>{group.label}</span>
                <span className={styles.sideNavMeta}>{group.description}</span>
              </a>
            )
          }

          const groupActive = group.children.some((child) => child.id === activeSection)
          return (
            <div
              key={group.id}
              className={`${localStyles.navGroup} ${groupActive ? localStyles.navGroupActive : ''}`}
            >
              <div className={localStyles.navGroupHead}>
                <span className={styles.sideNavLabel}>{group.label}</span>
                <span className={styles.sideNavMeta}>{group.description}</span>
              </div>
              <div className={localStyles.navChildren}>
                {group.children.map((child) => (
                  <a
                    key={child.id}
                    href={`#${child.anchor}`}
                    className={`${localStyles.navChildLink} ${activeSection === child.id ? localStyles.navChildLinkActive : ''}`}
                  >
                    <span className={localStyles.navChildLabel}>{child.label}</span>
                    <span className={localStyles.navChildMeta}>{child.description}</span>
                  </a>
                ))}
              </div>
            </div>
          )
        })}
      </nav>
    </aside>
  )
}
