import { memoryRepo } from '@mas/db'
import type {
  AgentSystem,
  MemoryRecord,
  PendingMemoryQuery,
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

export interface MemoryConsolidationKeepAction {
  op: 'keep'
  id: string
}

export interface MemoryConsolidationRewriteAction {
  op: 'rewrite'
  id: string
  summary: string
  tags: string[]
  importance: number
}

export interface MemoryConsolidationMergeAction {
  op: 'merge'
  sourceIds: string[]
  summary: string
  tags: string[]
  importance: number
}

export type MemoryConsolidationAction =
  | MemoryConsolidationKeepAction
  | MemoryConsolidationRewriteAction
  | MemoryConsolidationMergeAction

const BILINGUAL_TAG_GUIDANCE = [
  'tags must include at least 6 short reusable keywords.',
  'Every tag list MUST contain both Chinese and English equivalents for each important concept (strictly bilingual).',
  'Do not output tags in only one language.',
  'Example tags: ["名字", "name", "称呼", "introduction", "宠物", "pet"].',
].join('\n')

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

export function resolveMemorySqliteConfig(config: unknown): MemoryModuleConfig {
  return readConfig(config)
}

export function isSqliteMemoryConfig(config: unknown): boolean {
  return !!config
    && typeof config === 'object'
    && !Array.isArray(config)
    && (config as Record<string, unknown>).scheme === 'sqlite'
}

function buildSummaryPrompt(): string {
  return [
    'You summarize one completed conversation turn into a durable memory for future turns.',
    'Use only the provided turn transcript.',
    'Return strict JSON with exactly these keys:',
    '{"summary": string, "tags": string[], "importance": number}',
    'importance must be a number between 0 and 1.',
    BILINGUAL_TAG_GUIDANCE,
    'Do not add markdown or code fences.',
  ].join('\n')
}

function buildRetrievePrompt(): string {
  return [
    'You expand retrieval keywords for searching persona memories by tag.',
    'The user input will be provided as the only user message.',
    'Return strict JSON with exactly this shape:',
    '{"keywords": string[]}',
    'List 4-8 short reusable retrieval keywords when possible.',
    'Include Chinese and English synonyms when relevant.',
    'Do not just copy the surface words. Expand to paraphrases, related topics, and likely tag variants.',
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

function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) {
    return []
  }

  return [...new Set(
    tags
      .filter((tag): tag is string => typeof tag === 'string')
      .map(tag => tag.trim())
      .filter(Boolean),
  )]
}

function normalizeImportance(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? Math.min(1, Math.max(0, numeric)) : 0.5
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

  const tags = normalizeTags(record.tags)
  const importance = normalizeImportance(record.importance)

  return {
    summary,
    tags,
    importance,
  }
}

function parseMemoryQueryResponse(responseText: string): string[] {
  let parsed: unknown

  try {
    parsed = extractJson(responseText)
  } catch {
    throw new Error('Memory query call returned invalid JSON')
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Memory query call did not return a JSON object')
  }

  const record = parsed as Record<string, unknown>
  const keywords = Array.isArray(record.keywords)
    ? [...new Set(
        record.keywords
          .filter((keyword): keyword is string => typeof keyword === 'string')
          .map(keyword => keyword.trim())
          .filter(Boolean),
      )]
    : []

  if (keywords.length === 0) {
    throw new Error('Memory query call returned no keywords')
  }

  return keywords
}


export function buildMemoryConsolidationPrompt(): string {
  return [
    'You consolidate stored sqlite memories for one agent.',
    'Use only the provided memory list.',
    'Return strict JSON with exactly this shape:',
    '{"actions": Array<keep|rewrite|merge>}',
    'keep action: {"op":"keep","id":"memory-id"}',
    'rewrite action: {"op":"rewrite","id":"memory-id","summary":string,"tags":string[],"importance":number}',
    'merge action: {"op":"merge","sourceIds":string[],"summary":string,"tags":string[],"importance":number}',
    'Keep facts unless they are duplicated or can be rewritten more clearly.',
    'A memory id may appear at most once across all actions.',
    'sourceIds must contain at least 2 ids when merging.',
    'importance must be a number between 0 and 1.',
    BILINGUAL_TAG_GUIDANCE,
    'Do not add markdown or code fences.',
  ].join('\n')
}

export function buildMemoryConsolidationSourceText(memories: MemoryRecord[]): string {
  return [
    'Memories to consolidate (oldest first):',
    JSON.stringify(
      memories.map((memory) => ({
        id: memory.id,
        summary: memory.summary,
        tags: memory.tags,
        importance: memory.importance,
        createdAt: memory.createdAt.toISOString(),
      })),
      null,
      2,
    ),
  ].join('\n')
}

export function parseMemoryConsolidationResponse(responseText: string): MemoryConsolidationAction[] {
  const parsed = extractJson(responseText)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Memory consolidate call did not return a JSON object')
  }

  const actions = (parsed as { actions?: unknown }).actions
  if (!Array.isArray(actions)) {
    throw new Error('Memory consolidate call did not return an actions array')
  }

  return actions.map((action, index) => {
    if (!action || typeof action !== 'object' || Array.isArray(action)) {
      throw new Error(`Memory consolidate action ${index} is not an object`)
    }

    const record = action as Record<string, unknown>
    const op = record.op

    if (op === 'keep') {
      const id = typeof record.id === 'string' ? record.id.trim() : ''
      if (!id) {
        throw new Error(`Memory consolidate keep action ${index} is missing id`)
      }
      return { op, id }
    }

    if (op === 'rewrite') {
      const id = typeof record.id === 'string' ? record.id.trim() : ''
      const summary = typeof record.summary === 'string' ? record.summary.trim() : ''
      if (!id || !summary) {
        throw new Error(`Memory consolidate rewrite action ${index} is missing fields`)
      }
      return {
        op,
        id,
        summary,
        tags: normalizeTags(record.tags),
        importance: normalizeImportance(record.importance),
      }
    }

    if (op === 'merge') {
      const sourceIds = Array.isArray(record.sourceIds)
        ? [...new Set(
            record.sourceIds
              .filter((id): id is string => typeof id === 'string')
              .map(id => id.trim())
              .filter(Boolean),
          )]
        : []
      const summary = typeof record.summary === 'string' ? record.summary.trim() : ''
      if (sourceIds.length < 2 || !summary) {
        throw new Error(`Memory consolidate merge action ${index} is missing fields`)
      }
      return {
        op,
        sourceIds,
        summary,
        tags: normalizeTags(record.tags),
        importance: normalizeImportance(record.importance),
      }
    }

    throw new Error(`Memory consolidate action ${index} has unknown op`)
  })
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
    const fallback = tokenizeText(ctx.input.text, this.minTermLength)

    const pending: PendingMemoryQuery = {
      kind: 'sqlite',
      system: this.name,
      prompt: buildRetrievePrompt(),
      inputText: ctx.input.text,
      fallback,
      parse: parseMemoryQueryResponse,
      retrieve: async (keywords) => memoryRepo.findRelevantMemories({
        agentId: ctx.agentId,
        terms: keywords,
        topK: this.retrieveTopK,
      }),
    }

    ctx.pendingMemoryQuery = pending
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
      persist: async (result) => (
        memoryRepo.addMemory({
          agentId: ctx.agentId,
          sessionId: ctx.sessionId,
          content: sourceText,
          summary: result.summary,
          tags: result.tags,
          importance: result.importance,
        })
      ),
    }

    ctx.pendingMemoryWrite = pending
  }
}
