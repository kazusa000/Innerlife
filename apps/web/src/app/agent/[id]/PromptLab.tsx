'use client'

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
  fields: PromptField[]
  onChange: (key: string, value: string) => void
}

export default function PromptLab({
  title = 'Prompt Lab',
  copy = '这里开放模块实际会送进 LLM 的 prompt。留空则回退到系统默认 prompt。',
  fields,
  onChange,
}: PromptLabProps) {
  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <div>
          <p className={styles.panelLabel}>Prompt</p>
          <h4 className={styles.panelTitle}>{title}</h4>
        </div>
        <span className={styles.panelPill}>{fields.length} 项</span>
      </div>
      <p className={styles.panelCopy}>{copy}</p>
      <div className={styles.promptStack}>
        {fields.map((field) => (
          <label key={field.key} className={styles.promptCard}>
            <div className={styles.promptHead}>
              <div>
                <span className={styles.promptLabel}>{field.label}</span>
                <p className={styles.promptHelper}>{field.helper}</p>
              </div>
              <button
                type="button"
                className={styles.subtleButton}
                onClick={() => onChange(field.key, '')}
                disabled={!field.value.trim()}
              >
                清空
              </button>
            </div>
            <textarea
              className={styles.promptTextarea}
              rows={field.rows ?? 6}
              value={field.value}
              onChange={(event) => onChange(field.key, event.target.value)}
              placeholder={field.placeholder}
            />
          </label>
        ))}
      </div>
    </section>
  )
}
