import {
  Culture,
  recognizeDateTime,
} from '@microsoft/recognizers-text-date-time'
import type { MemoryTimeAnalysisResult, MemoryTimeRange } from '../types'

const SHORT_DATETIME_WINDOW_MS = 5 * 60 * 1000

type ResolutionValue = {
  type?: unknown
  start?: unknown
  end?: unknown
  value?: unknown
}

type RecognizerResult = {
  resolution?: {
    values?: unknown
  }
}

function parseLocalDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) {
    return null
  }

  const [, yearText, monthText, dayText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  return new Date(year, month - 1, day, 0, 0, 0, 0)
}

function parseLocalDateTime(value: string, referenceDate: Date): Date | null {
  const dateTimeMatch = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3}))?$/.exec(value)
  if (dateTimeMatch) {
    const [, yearText, monthText, dayText, hourText, minuteText, secondText = '0', millisecondText = '0'] = dateTimeMatch
    return new Date(
      Number(yearText),
      Number(monthText) - 1,
      Number(dayText),
      Number(hourText),
      Number(minuteText),
      Number(secondText),
      Number(millisecondText.padEnd(3, '0')),
    )
  }

  const timeMatch = /^(\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3}))?$/.exec(value)
  if (timeMatch) {
    const [, hourText, minuteText, secondText = '0', millisecondText = '0'] = timeMatch
    return new Date(
      referenceDate.getFullYear(),
      referenceDate.getMonth(),
      referenceDate.getDate(),
      Number(hourText),
      Number(minuteText),
      Number(secondText),
      Number(millisecondText.padEnd(3, '0')),
    )
  }

  return null
}

function expandSingleDate(date: Date): MemoryTimeRange {
  return {
    start: date,
    end: new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      23,
      59,
      59,
      999,
    ),
  }
}

function expandSingleDateTime(date: Date): MemoryTimeRange {
  return {
    start: new Date(date.getTime() - SHORT_DATETIME_WINDOW_MS),
    end: new Date(date.getTime() + SHORT_DATETIME_WINDOW_MS),
  }
}

function normalizeResolutionValue(raw: ResolutionValue, referenceDate: Date): MemoryTimeRange | null {
  const type = typeof raw.type === 'string' ? raw.type : ''
  const start = typeof raw.start === 'string' ? parseLocalDateTime(raw.start, referenceDate) : null
  const end = typeof raw.end === 'string' ? parseLocalDateTime(raw.end, referenceDate) : null

  if (start && end) {
    return start.getTime() <= end.getTime()
      ? { start, end }
      : { start: end, end: start }
  }

  if (typeof raw.value !== 'string') {
    return null
  }

  if (type === 'date') {
    const date = parseLocalDate(raw.value)
    return date ? expandSingleDate(date) : null
  }

  if (type === 'datetime' || type === 'time') {
    const dateTime = parseLocalDateTime(raw.value, referenceDate)
    return dateTime ? expandSingleDateTime(dateTime) : null
  }

  return null
}

function extractTimeRange(result: RecognizerResult, referenceDate: Date): MemoryTimeRange | null {
  const resolution = result.resolution
  if (!resolution || typeof resolution !== 'object' || Array.isArray(resolution)) {
    return null
  }

  const values = (resolution as { values?: unknown }).values
  if (!Array.isArray(values) || values.length === 0) {
    return null
  }

  const firstValue = values[0]
  if (!firstValue || typeof firstValue !== 'object' || Array.isArray(firstValue)) {
    return null
  }

  return normalizeResolutionValue(firstValue as ResolutionValue, referenceDate)
}

function mergeRanges(ranges: MemoryTimeRange[]): MemoryTimeRange | null {
  if (ranges.length === 0) {
    return null
  }

  let start = ranges[0].start
  let end = ranges[0].end
  for (const range of ranges.slice(1)) {
    if (range.start.getTime() < start.getTime()) {
      start = range.start
    }
    if (range.end.getTime() > end.getTime()) {
      end = range.end
    }
  }

  return { start, end }
}

export function analyzeMemoryTimeText(
  userText: string,
  referenceDate = new Date(),
): MemoryTimeAnalysisResult {
  const matches = recognizeDateTime(
    userText,
    Culture.Chinese,
    undefined,
    referenceDate,
  )

  const ranges = matches
    .map((match) => extractTimeRange(match, referenceDate))
    .filter((range): range is MemoryTimeRange => range !== null)

  return {
    timeRange: mergeRanges(ranges),
  }
}
