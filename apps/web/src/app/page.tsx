import { appSettingsRepo } from '@mas/db'
import { initDb } from '@/lib/db-init'
import HomePageClient from './HomePageClient'

export const dynamic = 'force-dynamic'

export default function HomePage() {
  initDb()
  return <HomePageClient initialLocale={appSettingsRepo.getAppLocale()} />
}
