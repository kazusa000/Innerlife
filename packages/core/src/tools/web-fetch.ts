import type { Tool, ToolCallOptions, ToolResult } from './types'
import { isAbortError, throwIfAborted } from '../utils/abort'

const FETCH_TIMEOUT_MS = 30_000

function htmlToText(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<\/(p|div|section|article|main|header|footer|li|ul|ol|h[1-6]|br)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

function errorResult(url: string, message: string, status?: number): ToolResult {
  return {
    output: `Failed to fetch "${url}": ${message}`,
    isError: true,
    metadata: status ? { url, status } : { url },
  }
}

export const WebFetchTool: Tool = {
  name: 'web_fetch',
  description: '抓取网页并返回清洗后的正文文本。只在确实需要外部网页信息时使用。',
  inputSchema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL to fetch',
      },
    },
    required: ['url'],
  },

  async call(input: Record<string, unknown>, options?: ToolCallOptions): Promise<ToolResult> {
    const url = typeof input.url === 'string' ? input.url.trim() : ''
    if (!url) {
      return errorResult('(missing url)', 'url is required')
    }

    const controller = new AbortController()
    const userSignal = options?.signal
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    const abortOnUserSignal = () => controller.abort(userSignal?.reason)

    throwIfAborted(userSignal)
    userSignal?.addEventListener('abort', abortOnUserSignal, { once: true })

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'multi-agent-system/0.0.1',
        },
        signal: controller.signal,
      })

      if (!response.ok) {
        return errorResult(url, `HTTP ${response.status} ${response.statusText}`, response.status)
      }

      const body = await response.text()
      const text = htmlToText(body)

      return {
        output: text || '(no text content)',
        metadata: {
          url,
          status: response.status,
          contentType: response.headers.get('content-type') ?? 'unknown',
        },
      }
    } catch (error) {
      const message =
        isAbortError(error) && userSignal?.aborted
          ? 'request aborted'
          : error instanceof Error && error.name === 'AbortError'
          ? `request timed out after ${FETCH_TIMEOUT_MS}ms`
          : error instanceof Error
            ? error.message
            : String(error)
      return errorResult(url, message)
    } finally {
      clearTimeout(timeout)
      userSignal?.removeEventListener('abort', abortOnUserSignal)
    }
  },
}
