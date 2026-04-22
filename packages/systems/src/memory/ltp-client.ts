export interface LtpAnalysisResponse {
  candidates: string[]
  raw?: unknown
}

export interface LtpClient {
  analyze(input: { text: string; signal?: AbortSignal }): Promise<LtpAnalysisResponse>
}

function trimBaseUrl(value: string) {
  return value.endsWith('/') ? value.slice(0, -1) : value
}

export function createHttpLtpClient(baseUrl = process.env.MAS_LTP_BASE_URL): LtpClient {
  const normalizedBaseUrl = typeof baseUrl === 'string' ? trimBaseUrl(baseUrl.trim()) : ''

  return {
    async analyze({ text, signal }) {
      if (!normalizedBaseUrl) {
        throw new Error('MAS_LTP_BASE_URL is not configured')
      }

      const response = await fetch(`${normalizedBaseUrl}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal,
      })

      let data: unknown = null
      try {
        data = await response.json()
      } catch {
        data = null
      }

      if (!response.ok) {
        const errorMessage =
          data
          && typeof data === 'object'
          && !Array.isArray(data)
          && 'error' in data
          && typeof data.error === 'string'
            ? data.error
            : `LTP service request failed with status ${response.status}`
        throw new Error(errorMessage)
      }

      const rawCandidates =
        data
        && typeof data === 'object'
        && !Array.isArray(data)
        && 'candidates' in data
        && Array.isArray(data.candidates)
          ? data.candidates
          : []

      const candidates = rawCandidates
        .filter((candidate): candidate is string => typeof candidate === 'string')
        .map((candidate) => candidate.trim())
        .filter(Boolean)

      return {
        candidates,
        raw: data,
      }
    },
  }
}
