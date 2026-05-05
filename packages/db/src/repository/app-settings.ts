import { getRawSqlite } from '../client'

export type AppLocale = 'zh-CN' | 'en-US'

const APP_LOCALE_KEY = 'locale'
const DEFAULT_LOCALE: AppLocale = 'zh-CN'

export function isAppLocale(value: unknown): value is AppLocale {
  return value === 'zh-CN' || value === 'en-US'
}

export function normalizeAppLocale(value: unknown): AppLocale {
  return isAppLocale(value) ? value : DEFAULT_LOCALE
}

function ensureTable() {
  getRawSqlite().exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    )
  `)
}

export function getAppLocale(): AppLocale {
  ensureTable()
  const row = getRawSqlite()
    .prepare('SELECT value FROM app_settings WHERE key = ?')
    .get(APP_LOCALE_KEY) as { value: string } | undefined

  return normalizeAppLocale(row?.value)
}

export function setAppLocale(locale: AppLocale): AppLocale {
  ensureTable()
  getRawSqlite()
    .prepare(`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `)
    .run(APP_LOCALE_KEY, locale, Date.now())
  return locale
}
