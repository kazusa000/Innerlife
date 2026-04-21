'use client'

import styles from './manager-ui.module.css'

export type PromptField = {
  key: string
  label: string
  helper: string
  value: string
  placeholder: string
  rows?: number
  defaultValue?: string | null
  effectiveValue?: string
  sourceLabel?: string
}

type PromptLabProps = {
  title?: string
  copy?: string
  fields: PromptField[]
  onChange: (key: string, value: string) => void
  onReset?: (key: string) => void
}

export default function PromptLab({
  title = 'Prompt Lab',
  copy = '这里显示的是当前真正生效的 prompt。你可以直接在现有内容上修改并保存；恢复默认会回到系统 prompt。',
  fields,
  onChange,
  onReset,
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
                {field.sourceLabel && (
                  <p className={styles.promptMeta}>当前生效：{field.sourceLabel}</p>
                )}
              </div>
              <div className={styles.promptActions}>
                {field.defaultValue !== undefined && onReset ? (
                  <button
                    type="button"
                    className={styles.subtleButton}
                    onClick={() => onReset(field.key)}
                    disabled={field.value.trim() === (field.defaultValue ?? '').trim()}
                  >
                    恢复默认
                  </button>
                ) : (
                  <button
                    type="button"
                    className={styles.subtleButton}
                    onClick={() => onChange(field.key, '')}
                    disabled={!field.value.trim()}
                  >
                    清空
                  </button>
                )}
              </div>
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
