'use client'

import styles from '../agent/[id]/manager-ui.module.css'
import type { DaemonSection, DaemonSectionId } from './daemon-sections'

interface DaemonSectionNavProps {
  sections: DaemonSection[]
  activeSection: DaemonSectionId
}

export function DaemonSectionNav({ sections, activeSection }: DaemonSectionNavProps) {
  return (
    <aside className={styles.sideNav}>
      <div className={styles.sideNavHead}>
        <p className={styles.eyebrow}>后台控制台</p>
        <h2 className={styles.sideNavTitle}>Daemon Workbench</h2>
        <p className={styles.sideNavCopy}>
          查看 daemon 本体、图灵测试 run、记忆 flush、睡眠沉淀和最近后台事件。
        </p>
      </div>

      <nav className={styles.sideNavList} aria-label="Daemon sections">
        {sections.map((section) => (
          <a
            key={section.id}
            href={`#${section.anchor}`}
            className={`${styles.sideNavLink} ${activeSection === section.id ? styles.sideNavLinkActive : ''}`}
          >
            <span className={styles.sideNavLabel}>{section.label}</span>
            <span className={styles.sideNavMeta}>{section.description}</span>
          </a>
        ))}
      </nav>
    </aside>
  )
}
