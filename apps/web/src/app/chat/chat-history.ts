export interface DatedMessage {
  createdAt?: string | number | Date | null
}

function toDate(value: DatedMessage['createdAt']): Date {
  if (value instanceof Date) return value
  if (typeof value === 'number' || typeof value === 'string') return new Date(value)
  return new Date()
}

export function localDayKey(value: DatedMessage['createdAt']): string {
  const date = toDate(value)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function formatMessageTime(value: DatedMessage['createdAt']): string {
  const date = toDate(value)
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

export function formatDayLabel(
  dayKey: string,
  now: Date = new Date(),
  locale: 'zh-CN' | 'en-US' = 'zh-CN',
): string {
  const todayKey = localDayKey(now)
  if (dayKey === todayKey) return locale === 'en-US' ? 'Today' : '今天'

  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (dayKey === localDayKey(yesterday)) return locale === 'en-US' ? 'Yesterday' : '昨天'

  const [year, month, day] = dayKey.split('-')
  return `${year}-${month}-${day}`
}

export function getInitialVisibleDayKeys(messages: DatedMessage[], now: Date = new Date()): string[] {
  const todayKey = localDayKey(now)
  return messages.some((message) => localDayKey(message.createdAt) === todayKey)
    ? [todayKey]
    : []
}

function getSortedDayKeys(messages: DatedMessage[]): string[] {
  return [...new Set(messages.map((message) => localDayKey(message.createdAt)))].sort()
}

export function getNextHiddenDayKey(
  messages: DatedMessage[],
  visibleDayKeys: string[],
  now: Date = new Date(),
): string | null {
  const visible = new Set(visibleDayKeys)
  const todayKey = localDayKey(now)
  const hiddenPastDays = getSortedDayKeys(messages)
    .filter((dayKey) => dayKey < todayKey && !visible.has(dayKey))
    .sort((a, b) => b.localeCompare(a))
  return hiddenPastDays[0] ?? null
}

export function getVisibleMessages<T extends DatedMessage>(
  messages: T[],
  visibleDayKeys: string[],
): T[] {
  const visible = new Set(visibleDayKeys)
  return messages.filter((message) => visible.has(localDayKey(message.createdAt)))
}
