'use client'

import PromptTestPanel, { type PromptTestConfig } from './PromptTestPanel'
import { useAppLocale } from '@/app/use-app-locale'
import styles from './manager-ui.module.css'

export type PromptField = {
  key: string
  label: string
  helper: string
  value: string
  placeholder: string
  rows?: number
}

type PromptLabProps = {
  title?: string
  copy?: string
  agentId?: string
  layout?: 'stack' | 'grid'
  fields: PromptField[]
  tests?: Partial<Record<string, PromptTestConfig>>
  onChange: (key: string, value: string) => void
}

export default function PromptLab({
  title = 'Prompt Lab',
  copy = '这里编辑并保存的是当前会生效的文本。清空后保存会回退到系统默认。',
  agentId,
  layout = 'stack',
  fields,
  tests,
  onChange,
}: PromptLabProps) {
  const locale = useAppLocale()
  const fallbackCopy = locale === 'en-US'
    ? 'Edit and save the text that is currently effective. Empty fields fall back to the system default after saving.'
    : '这里编辑并保存的是当前会生效的文本。清空后保存会回退到系统默认。'

  return (
    <section className={`${styles.panel} ${layout === 'grid' ? styles.promptLabPanel : ''}`}>
      <div className={styles.panelHead}>
        <div>
          <p className={styles.panelLabel}>Prompt</p>
          <h4 className={styles.panelTitle}>{title}</h4>
        </div>
        <span className={styles.panelPill}>{locale === 'en-US' ? `${fields.length} items` : `${fields.length} 项`}</span>
      </div>
      <p className={styles.panelCopy}>{copy === '这里编辑并保存的是当前会生效的文本。清空后保存会回退到系统默认。' ? fallbackCopy : copy}</p>
      <div className={layout === 'grid' ? styles.promptGrid : styles.promptStack}>
        {fields.map((field) => {
          const testConfig = tests?.[field.key]
          return (
            <label key={field.key} className={styles.promptCard}>
              <div className={styles.promptHead}>
                <div>
                  <span className={styles.promptLabel}>{field.label}</span>
                  <p className={styles.promptHelper}>{field.helper}</p>
                </div>
                <div className={styles.promptActions}>
                  <button
                    type="button"
                    className={styles.subtleButton}
                    onClick={() => onChange(field.key, '')}
                    disabled={!field.value.trim()}
                  >
                    {locale === 'en-US' ? 'Clear' : '清空'}
                  </button>
                </div>
              </div>
              <textarea
                className={styles.promptTextarea}
                rows={field.rows ?? 6}
                value={field.value}
                onChange={(event) => onChange(field.key, event.target.value)}
                placeholder={field.placeholder}
              />
              {agentId && testConfig && (
                <PromptTestPanel
                  agentId={agentId}
                  testId={testConfig.testId}
                  defaultInput={testConfig.defaultInput}
                  prompt={field.value}
                />
              )}
            </label>
          )
        })}
      </div>
    </section>
  )
}
