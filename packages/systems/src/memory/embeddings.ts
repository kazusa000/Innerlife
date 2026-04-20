export const DEFAULT_MEMORY_EMBEDDING_MODEL = 'qwen/qwen3-embedding-0.6b'
const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

export type MemoryEmbeddingInputType = 'search_query' | 'search_document'

export interface MemoryEmbedder {
  embed(input: string[], options?: {
    model?: string | null
    inputType?: MemoryEmbeddingInputType
  }): Promise<number[][]>
}

interface OpenRouterEmbeddingResponse {
  data?: Array<{
    embedding?: unknown
    index?: number
  }>
  error?: {
    message?: string
  }
  message?: string
}

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value ? value : undefined
}

function buildHeaders(apiKey = readEnv('OPENROUTER_API_KEY')) {
  const headers = new Headers({
    'Content-Type': 'application/json',
  })

  if (apiKey) {
    headers.set('Authorization', `Bearer ${apiKey}`)
  }

  const referer = readEnv('OPENROUTER_HTTP_REFERER') ?? readEnv('OPENROUTER_SITE_URL')
  const title = readEnv('OPENROUTER_TITLE') ?? readEnv('OPENROUTER_SITE_NAME')

  if (referer) {
    headers.set('HTTP-Referer', referer)
  }
  if (title) {
    headers.set('X-OpenRouter-Title', title)
  }

  return headers
}

function normalizeInputs(input: string[]) {
  return input
    .map((value) => value.trim())
    .filter(Boolean)
}

export function createOpenRouterMemoryEmbedder(options: {
  apiKey?: string
  baseURL?: string
  fetchImpl?: typeof fetch
  defaultModel?: string
} = {}): MemoryEmbedder {
  const {
    apiKey = readEnv('OPENROUTER_API_KEY'),
    baseURL = readEnv('OPENROUTER_BASE_URL') ?? DEFAULT_OPENROUTER_BASE_URL,
    fetchImpl = fetch,
    defaultModel = DEFAULT_MEMORY_EMBEDDING_MODEL,
  } = options

  return {
    async embed(input, embedOptions = {}) {
      const normalizedInput = normalizeInputs(input)
      if (normalizedInput.length === 0) {
        return []
      }
      if (!apiKey?.trim()) {
        throw new Error('OPENROUTER_API_KEY is required for memory embeddings')
      }

      const response = await fetchImpl(`${baseURL}/embeddings`, {
        method: 'POST',
        headers: buildHeaders(apiKey),
        body: JSON.stringify({
          model: embedOptions.model?.trim() || defaultModel,
          input: normalizedInput,
          input_type: embedOptions.inputType,
          encoding_format: 'float',
        }),
      })

      const payload = await response.json() as OpenRouterEmbeddingResponse
      if (!response.ok) {
        throw new Error(payload.error?.message ?? payload.message ?? `OpenRouter embeddings request failed: ${response.status}`)
      }

      const embeddings = (payload.data ?? [])
        .sort((left, right) => (left.index ?? 0) - (right.index ?? 0))
        .map((item) => Array.isArray(item.embedding)
          ? item.embedding.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
          : [])

      if (embeddings.length !== normalizedInput.length) {
        throw new Error('OpenRouter embeddings response length mismatch')
      }

      return embeddings
    },
  }
}
