import { memoryRepo } from '@mas/db'
import type {
  AgentSystem,
  MemoryRecord,
  MemoryWriteResult,
  PendingMemoryWrite,
  TurnContext,
} from '../types'

const DEFAULT_RETRIEVE_TOP_K = 5
const DEFAULT_MIN_TERM_LENGTH = 2
const MAX_MEMORY_CONTENT_CHARS = 500
const LATIN_STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'did',
  'do',
  'does',
  'for',
  'how',
  'i',
  'is',
  'it',
  'me',
  'my',
  'of',
  'or',
  'the',
  'to',
  'was',
  'what',
  'when',
  'where',
  'who',
  'why',
  'you',
  'your',
])
const CJK_STOPWORDS = new Set([
  '了',
  '他',
  '们',
  '你',
  '叫',
  '吗',
  '啊',
  '啥',
  '呢',
  '和',
  '在',
  '她',
  '它',
  '就',
  '我',
  '是',
  '有',
  '的',
  '什',
  '要',
  '说',
  '谁',
  '这',
  '那',
  '都',
  '么',
])

interface MemoryModuleConfig {
  summarizeModel: string | null
  retrieveTopK: number
  minTermLength: number
}

function readConfig(config: unknown): MemoryModuleConfig {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return {
      summarizeModel: null,
      retrieveTopK: DEFAULT_RETRIEVE_TOP_K,
      minTermLength: DEFAULT_MIN_TERM_LENGTH,
    }
  }

  const record = config as Record<string, unknown>
  const retrieveTopK = typeof record.retrieveTopK === 'number' && record.retrieveTopK > 0
    ? Math.floor(record.retrieveTopK)
    : DEFAULT_RETRIEVE_TOP_K
  const minTermLength = typeof record.minTermLength === 'number' && record.minTermLength > 0
    ? Math.floor(record.minTermLength)
    : DEFAULT_MIN_TERM_LENGTH

  return {
    summarizeModel: typeof record.summarizeModel === 'string'
      ? record.summarizeModel.trim() || null
      : null,
    retrieveTopK,
    minTermLength,
  }
}

function buildSummaryPrompt(): string {
  return [
    'You summarize one completed conversation turn into a durable memory for future turns.',
    'Use only the provided turn transcript.',
    'Return strict JSON with exactly these keys:',
    '{"summary": string, "tags": string[], "importance": number}',
    'importance must be a number between 0 and 1.',
    'tags should be short reusable keywords.',
    'Do not add markdown or code fences.',
  ].join('\n')
}

function renderMemoryFragment(memories: MemoryRecord[]): string | null {
  if (memories.length === 0) {
    return null
  }

  return [
    'Relevant memories (most important first):',
    ...memories.map((memory) => `- ${memory.summary}`),
  ].join('\n')
}

function extractResponseText(ctx: TurnContext): string {
  if (!ctx.response) {
    return ''
  }

  return ctx.response.content
    .map((block) => {
      if (
        block
        && typeof block === 'object'
        && 'type' in block
        && (block as { type: unknown }).type === 'text'
        && 'text' in block
        && typeof (block as { text: unknown }).text === 'string'
      ) {
        return (block as { text: string }).text
      }
      return JSON.stringify(block)
    })
    .join('\n')
    .trim()
}

function truncate(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}...`
}

function buildSourceText(ctx: TurnContext): string {
  const userText = ctx.input.text.trim()
  const assistantText = extractResponseText(ctx)

  if (!userText && !assistantText) {
    return ''
  }

  return truncate([
    `User: ${userText || '(empty)'}`,
    `Assistant: ${assistantText || '(empty)'}`,
  ].join('\n'), MAX_MEMORY_CONTENT_CHARS)
}

function containsCjk(text: string): boolean {
  return /[\u3400-\u9fff]/u.test(text)
}

function tokenizeText(text: string, minTermLength: number): string[] {
  const matches = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  const tokens = new Set<string>()

  for (const match of matches) {
    if (!match) {
      continue
    }

    if (containsCjk(match)) {
      for (const char of Array.from(match)) {
        if (CJK_STOPWORDS.has(char)) {
          continue
        }
        tokens.add(char)
      }

      if (match.length >= minTermLength && !CJK_STOPWORDS.has(match)) {
        tokens.add(match)
      }

      continue
    }

    if (match.length < minTermLength || LATIN_STOPWORDS.has(match)) {
      continue
    }

    tokens.add(match)
  }

  return [...tokens]
}

function extractJson(text: string): unknown {
  const withoutFences = text
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')

  const start = withoutFences.indexOf('{')
  const end = withoutFences.lastIndexOf('}')
  const candidate = start >= 0 && end > start
    ? withoutFences.slice(start, end + 1)
    : withoutFences

  return JSON.parse(candidate)
}

function parseMemoryWriteResponse(responseText: string): MemoryWriteResult {
  const parsed = extractJson(responseText)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Memory summarize call did not return a JSON object')
  }

  const record = parsed as Record<string, unknown>
  const summary = typeof record.summary === 'string' ? record.summary.trim() : ''
  if (!summary) {
    throw new Error('Memory summarize call returned an empty summary')
  }

  const tags = Array.isArray(record.tags)
    ? [...new Set(
        record.tags
          .filter((tag): tag is string => typeof tag === 'string')
          .map(tag => tag.trim())
          .filter(Boolean),
      )]
    : []
  const numericImportance = typeof record.importance === 'number'
    ? record.importance
    : Number(record.importance)
  const importance = Number.isFinite(numericImportance)
    ? Math.min(1, Math.max(0, numericImportance))
    : 0.5

  return {
    summary,
    tags,
    importance,
  }
}

export class MemorySqliteSystem implements AgentSystem {
  name = 'memory:sqlite'
  type = 'memory'

  private readonly summarizeModel: string | null
  private readonly retrieveTopK: number
  private readonly minTermLength: number

  constructor(config?: unknown) {
    const resolved = readConfig(config)
    this.summarizeModel = resolved.summarizeModel
    this.retrieveTopK = resolved.retrieveTopK
    this.minTermLength = resolved.minTermLength
  }

  async beforeTurn(ctx: TurnContext): Promise<void> {
    const terms = tokenizeText(ctx.input.text, this.minTermLength)
    const memories = memoryRepo.findRelevantMemories({
      agentId: ctx.agentId,
      terms,
      topK: this.retrieveTopK,
    })

    ctx.state.memories = memories
    ctx.turnMetadata.memory = {
      hitCount: memories.length,
      terms,
      memoryIds: memories.map((memory) => memory.id),
    }
  }

  async beforeLLM(ctx: TurnContext): Promise<void> {
    const memories = Array.isArray(ctx.state.memories) ? ctx.state.memories : []
    const content = renderMemoryFragment(memories)
    if (!content) {
      return
    }

    ctx.promptFragments.push({
      source: this.name,
      priority: 30,
      content,
    })
  }

  async afterTurn(ctx: TurnContext): Promise<void> {
    const sourceText = buildSourceText(ctx)
    if (!sourceText) {
      return
    }

    const pending: PendingMemoryWrite = {
      kind: 'sqlite',
      system: this.name,
      model: this.summarizeModel,
      prompt: buildSummaryPrompt(),
      sourceText,
      parse: parseMemoryWriteResponse,
      persist: async (result) => {
        memoryRepo.addMemory({
          agentId: ctx.agentId,
          sessionId: ctx.sessionId,
          content: sourceText,
          summary: result.summary,
          tags: result.tags,
          importance: result.importance,
        })
      },
    }

    ctx.pendingMemoryWrite = pending
  }
}
