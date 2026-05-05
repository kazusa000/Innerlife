'use client'

import { useEffect, useState } from 'react'
import { normalizeLocale, type AppLocale } from './app-i18n'

export function useAppLocale(initialLocale: AppLocale = 'zh-CN') {
  const [locale, setLocale] = useState<AppLocale>(initialLocale)

  useEffect(() => {
    let cancelled = false
    async function loadLocale() {
      const response = await fetch('/api/settings/locale', { cache: 'no-store' })
      const data = await response.json().catch(() => null) as { locale?: unknown } | null
      if (!cancelled) {
        setLocale(normalizeLocale(data?.locale))
      }
    }

    void loadLocale()
    return () => {
      cancelled = true
    }
  }, [])

  return locale
}
