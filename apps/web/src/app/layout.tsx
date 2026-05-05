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
        title: 'Virtual Persona',
        description: 'Your AI companion with memory, personality, and long-term presence.',
      }
    : {
        title: '虚拟人格',
        description: '你的 AI 陪伴者，拥有记忆、性格与长期存在感。',
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
