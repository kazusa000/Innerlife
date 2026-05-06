import { appSettingsRepo } from '@mas/db'
import { initDb } from '@/lib/db-init'

export async function GET() {
  initDb()
  return Response.json({ locale: appSettingsRepo.getAppLocale() })
}

export async function PATCH(request: Request) {
  initDb()
  const body = await request.json().catch(() => null)
  const locale = body && typeof body === 'object' && 'locale' in body
    ? (body as { locale?: unknown }).locale
    : null

  if (!appSettingsRepo.isAppLocale(locale)) {
    return Response.json({ error: 'locale must be zh-CN or en-US' }, { status: 400 })
  }

  return Response.json({ locale: appSettingsRepo.setAppLocale(locale) })
}
