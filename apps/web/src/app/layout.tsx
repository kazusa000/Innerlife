import type { Metadata } from 'next'
import { Fraunces, Plus_Jakarta_Sans } from 'next/font/google'
import { appSettingsRepo } from '@mas/db'
import { initDb } from '@/lib/db-init'
import './globals.css'

const display = Fraunces({
  subsets: ['latin'],
  variable: '--font-display',
  weight: 'variable',
  axes: ['SOFT', 'opsz'],
  display: 'swap',
})

const body = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-body',
  weight: ['300', '400', '500', '600', '700'],
  display: 'swap',
})

export const dynamic = 'force-dynamic'

function getLocale() {
  initDb()
  return appSettingsRepo.getAppLocale()
}

export function generateMetadata(): Metadata {
  const locale = getLocale()
  return locale === 'en-US'
    ? {
        title: 'Innerlife',
        description: 'An experimental local runtime for virtual personas with memory, emotion, relationships, and observable inner state.',
      }
    : {
        title: 'Innerlife',
        description: '一个本地虚拟人格运行时，探索记忆、情绪、关系与可观测的内部状态。',
      }
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const locale = getLocale()
  return (
    <html lang={locale} className={`${display.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  )
}
