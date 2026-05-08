import {
  createProvider,
  getDefaultTools,
  resolveAgentTools,
  type LLMProvider,
  type LLMRequest,
  type LLMResponse,
} from '@mas/core'
import { agentRepo, appSettingsRepo } from '@mas/db'
import {
  buildContextToShortTermPrompt,
  buildContextToShortTermSourceText,
  buildEmotionAnalysisPrompt,
  buildEmotionFragment,
  buildEntityMentionPrompt,
  buildEntityResolutionPrompt,
  buildEpisodicExtractionPrompt,
  buildFixedMemoryFragmentPrompt,
  buildRelationshipAnalysisPrompt,
  buildRelationshipFragment,
  buildSemanticAnalyzerInputText,
  buildSemanticAnalyzerPrompt,
  buildShortTermFragmentPrompt,
  buildShortTermToLongTermSourceText,
  buildTimeAnalyzerInputText,
  buildTimeAnalyzerPrompt,
  isSqliteMemoryConfig,
  MEMORY_BATCH_WRITE_RESPONSE_FORMAT,
  parseEmotionAnalysis,
  parseEntityMentionResponse,
  parseEntityResolutionResponse,
  parseEpisodicExtractionResponse,
  parseMemoryBatchWriteResponse,
  parseRelationshipAnalysis,
  resolveMemoryActorLabels,
  resolveMemoryPipelineSettings,
  resolveMemorySqliteConfig,
  renderLayeredMemoryFragment,
  type ConversationMessage,
  type MemoryRecord,
  type RelationshipDimensions,
} from '@mas/systems'
import { readPersonalityPrompts } from '@/lib/chat-executor'

type ProviderLike = Pick<LLMProvider, 'sendMessage'>
type AgentRecord = NonNullable<ReturnType<typeof agentRepo.getAgent>>
type PromptTestMode = 'llm' | 'render'

type PromptTestRunInput = {
  testId?: unknown
  prompt?: unknown
  input?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readText(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function readPromptOverride(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readModuleAnalysisModel(agent: AgentRecord, moduleName: 'emotion' | 'relationship') {
  const moduleConfig = isRecord(agent.modules?.[moduleName]) ? agent.modules?.[moduleName] : null
  const value = readText(moduleConfig?.analysisModel).trim()
  return value || agent.model
}

function extractText(response: LLMResponse) {
  return response.content
    .map((block) => block.type === 'text' ? block.text : '')
    .join('\n')
    .trim()
}

function parseJsonValue(raw: string) {
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

function readPromptTestSamples(modules: AgentRecord['modules']) {
  const promptTests = isRecord(modules?.promptTests) ? modules?.promptTests : null
  const samples = isRecord(promptTests?.samples) ? promptTests.samples : {}
  return samples as Record<string, unknown>
}

function writePromptTestSamples(agent: AgentRecord, samples: Record<string, unknown>) {
  const nextModules = isRecord(agent.modules) ? { ...agent.modules } : {}
  const currentPromptTests = isRecord(nextModules.promptTests) ? nextModules.promptTests : {}
  nextModules.promptTests = {
    ...currentPromptTests,
    samples,
  }
  return agentRepo.updateAgent(agent.id, { modules: nextModules })
}

function serializeSamples(samples: Record<string, unknown>) {
  return JSON.parse(JSON.stringify(samples)) as Record<string, unknown>
}

export function buildDefaultPromptTestInputs(agent: AgentRecord) {
  const locale = appSettingsRepo.getAppLocale()
  const toolDefaults = Object.fromEntries(
    resolveAgentTools({
      tools: getDefaultTools(),
      modules: agent.modules,
      config: agent.tools ?? null,
      locale,
    }).catalog.map((tool) => [
      `tools.${tool.name}.description`,
      {
        toolName: tool.name,
        userMessage: locale === 'en-US'
          ? tool.name === 'web_fetch'
            ? 'Please check the content of this web page.'
            : 'Do you remember the game I mentioned before?'
          : tool.name === 'web_fetch'
            ? '帮我查一下这个网页的内容。'
            : '你还记得我之前说过的游戏吗？',
      },
    ]),
  )

  if (locale === 'en-US') {
    return {
      'personality.systemPrompt': { userMessage: 'Do you remember what game I like?' },
      'personality.personaPrompt': { userMessage: 'I am a bit tired today. Let us just talk.' },
      'personality.thinkingModePrompt': { userMessage: 'Help me think through how to fix this memory system.' },
      'memory.semanticAnalyzer': {
        recentMessages: [
          { role: 'user', text: 'My favorite game is Star Voyage II.' },
          { role: 'assistant', text: 'I will remember that.' },
        ],
        currentUserMessage: 'What was that game called again?',
      },
      'memory.timeAnalyzer': {
        recentMessages: [
          { role: 'user', text: 'I had dinner a little late yesterday.' },
          { role: 'assistant', text: 'I will remember that.' },
        ],
        currentUserMessage: 'What did I eat for dinner yesterday?',
      },
      'memory.contextToShortTerm': {
        messages: [
          { role: 'user', text: 'I recently started playing Star Voyage II again.' },
          { role: 'assistant', text: 'You mentioned it before too.' },
          { role: 'user', text: 'Yes, remember that it is a game I like.' },
        ],
      },
      'memory.entityMention': {
        currentUserMessage: 'Is Star Voyage II or World of Warcraft closer to the game I used to like?',
      },
      'memory.episodicExtraction': {
        memories: [
          { detail: 'The source says the user changed their favorite game from World of Warcraft to Star Voyage II.', retrievalText: 'The user used to favor World of Warcraft and later changed to Star Voyage II.', importance: 0.82 },
          { detail: 'The source says the user cares whether SV2 and Star Voyage II aliases merge correctly.', retrievalText: 'SV2 is an abbreviation for Star Voyage II, and the user wants aliases to be stable.', importance: 0.76 },
        ],
      },
      'memory.entityResolution': {
        candidates: [{
          local_entity_id: 'local-game-1',
          surface: 'SV2',
          type: 'object',
          context_hint: 'abbreviation for a game mentioned by the user',
          candidates: [{ entity_id: 'entity-sc2', canonical_name: 'Star Voyage II', type: 'object', description: 'a game the user likes' }],
        }],
      },
      'memory.shortTermFragment': {
        memories: [{ detail: 'The source says the user just mentioned Star Voyage II as a game they like.', retrievalText: 'The user likes Star Voyage II.', importance: 0.7, observedStartAt: '2026-04-30T10:00:00.000Z', observedEndAt: '2026-04-30T10:05:00.000Z' }],
      },
      'memory.fixedFragment': {
        memories: [{ detail: 'The source says the user has a stable preference for science-fiction real-time strategy games.', retrievalText: 'The user likes science-fiction real-time strategy games.', importance: 0.8, createdAt: '2026-04-30T10:00:00.000Z' }],
      },
      'emotion.fragment': { state: { mood: -0.15, energy: 0.45, stress: 0.65 } },
      'emotion.analysis': { state: { mood: 0.05, energy: 0.55, stress: 0.3 }, userMessage: 'I tested a pile of bugs today and feel irritated.', assistantReply: 'It sounds like you have already narrowed the issue down; we can break it into smaller pieces.' },
      'relationship.fragment': { state: { trust: 0.64, affinity: 0.58, familiarity: 0.42, respect: 0.7 }, counterpart: { name: 'Lin', role: 'user', description: 'the person building the virtual persona system', note: 'prefers direct feedback on design issues' } },
      'relationship.analysis': { state: { trust: 0.64, affinity: 0.58, familiarity: 0.42, respect: 0.7 }, counterpart: { name: 'Lin' }, userMessage: 'This UI is hard to use. Look at it yourself.', assistantReply: 'I will inspect the actual page first, then tighten the layout.' },
      'relationshipNamed.fragment': { state: { trust: 0.64, affinity: 0.58, familiarity: 0.42, respect: 0.7 }, counterpart: { name: 'Lin', role: 'user', description: 'the person building the virtual persona system', note: 'prefers direct feedback on design issues' } },
      'relationshipNamed.analysis': { state: { trust: 0.64, affinity: 0.58, familiarity: 0.42, respect: 0.7 }, counterpart: { name: 'Lin' }, userMessage: 'This UI is hard to use. Look at it yourself.', assistantReply: 'I will inspect the actual page first, then tighten the layout.' },
      ...toolDefaults,
    }
  }

  return {
    'personality.systemPrompt': {
      userMessage: '你还记得我喜欢什么游戏吗？',
    },
    'personality.personaPrompt': {
      userMessage: '我今天有点累，随便聊聊。',
    },
    'personality.thinkingModePrompt': {
      userMessage: '帮我想一下怎么修这个记忆系统。',
    },
    'memory.semanticAnalyzer': {
      recentMessages: [
        { role: 'user', text: '我最喜欢的游戏是星河2。' },
        { role: 'assistant', text: '我记住了。' },
      ],
      currentUserMessage: '那个游戏叫什么来着？',
    },
    'memory.timeAnalyzer': {
      recentMessages: [
        { role: 'user', text: '我昨天晚饭吃得有点晚。' },
        { role: 'assistant', text: '我记住了。' },
      ],
      currentUserMessage: '我昨天晚饭吃了什么？',
    },
    'memory.contextToShortTerm': {
      messages: [
        { role: 'user', text: '我最近又开始玩星河2了。' },
        { role: 'assistant', text: '你之前也提到过它。' },
        { role: 'user', text: '对，我想让你记住它是我喜欢的游戏。' },
      ],
    },
    'memory.entityMention': {
      currentUserMessage: '星河2和云海纪元哪个更像我以前喜欢的游戏？',
    },
    'memory.episodicExtraction': {
      memories: [
        {
          detail: '原文说明用户说最喜欢的游戏从云海纪元改成了星河2。',
          retrievalText: '用户最喜欢的游戏曾是云海纪元，后来改成星河2。',
          importance: 0.82,
        },
        {
          detail: '原文说明用户关心星河2和星河战术2 alias 是否能合并。',
          retrievalText: '星河2是星河战术2的简称，用户希望实体 alias 稳定。',
          importance: 0.76,
        },
      ],
    },
    'memory.entityResolution': {
      candidates: [
        {
          local_entity_id: 'local-game-1',
          surface: '星河2',
          type: 'object',
          context_hint: '用户提到的游戏简称',
          candidates: [
            {
              entity_id: 'entity-sc2',
              canonical_name: '星河战术2',
              type: 'object',
              description: '用户喜欢的游戏',
            },
          ],
        },
      ],
    },
    'memory.shortTermFragment': {
      memories: [
        {
          detail: '原文说明用户刚刚提到星河2是喜欢的游戏。',
          retrievalText: '用户喜欢星河2。',
          importance: 0.7,
          observedStartAt: '2026-04-30T10:00:00.000Z',
          observedEndAt: '2026-04-30T10:05:00.000Z',
        },
      ],
    },
    'memory.fixedFragment': {
      memories: [
        {
          detail: '原文说明用户稳定偏好科幻即时战略游戏。',
          retrievalText: '用户喜欢科幻即时战略游戏。',
          importance: 0.8,
          createdAt: '2026-04-30T10:00:00.000Z',
        },
      ],
    },
    'emotion.fragment': {
      state: { mood: -0.15, energy: 0.45, stress: 0.65 },
    },
    'emotion.analysis': {
      state: { mood: 0.05, energy: 0.55, stress: 0.3 },
      userMessage: '我今天测了一堆 bug，有点烦。',
      assistantReply: '听起来你已经定位到问题了，我们可以一块把它拆小。',
    },
    'relationship.fragment': {
      state: { trust: 0.64, affinity: 0.58, familiarity: 0.42, respect: 0.7 },
      counterpart: {
        name: 'Lin',
        role: '用户',
        description: '正在构建虚拟人系统的人',
        note: '喜欢直接指出设计问题',
      },
    },
    'relationship.analysis': {
      state: { trust: 0.64, affinity: 0.58, familiarity: 0.42, respect: 0.7 },
      counterpart: { name: 'Lin' },
      userMessage: '这个 UI 太难用了，你自己看看。',
      assistantReply: '我会先看实际页面，再把布局压紧。',
    },
    'relationshipNamed.fragment': {
      state: { trust: 0.64, affinity: 0.58, familiarity: 0.42, respect: 0.7 },
      counterpart: {
        name: 'Lin',
        role: '用户',
        description: '正在构建虚拟人系统的人',
        note: '喜欢直接指出设计问题',
      },
    },
    'relationshipNamed.analysis': {
      state: { trust: 0.64, affinity: 0.58, familiarity: 0.42, respect: 0.7 },
      counterpart: { name: 'Lin' },
      userMessage: '这个 UI 太难用了，你自己看看。',
      assistantReply: '我会先看实际页面，再把布局压紧。',
    },
    ...toolDefaults,
  }
}

export function getPromptTestSamples(agentId: string) {
  const agent = agentRepo.getAgent(agentId)
  if (!agent) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  return Response.json({
    agentId,
    defaults: serializeSamples(buildDefaultPromptTestInputs(agent)),
    samples: serializeSamples(readPromptTestSamples(agent.modules)),
  })
}

export function updatePromptTestSamples(agentId: string, body: unknown) {
  const agent = agentRepo.getAgent(agentId)
  if (!agent) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }
  if (!isRecord(body)) {
    return Response.json({ error: 'body must be an object' }, { status: 400 })
  }

  const testId = readText(body.testId).trim()
  if (!testId) {
    return Response.json({ error: 'testId is required' }, { status: 400 })
  }

  const samples = { ...readPromptTestSamples(agent.modules) }
  if (body.reset === true) {
    delete samples[testId]
  } else if ('input' in body) {
    samples[testId] = body.input
  } else {
    return Response.json({ error: 'input or reset is required' }, { status: 400 })
  }

  const updated = writePromptTestSamples(agent, samples)
  if (!updated) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  return Response.json({
    agentId,
    samples: serializeSamples(readPromptTestSamples(updated.modules)),
  })
}

function readConversationMessages(input: unknown): ConversationMessage[] {
  const items = isRecord(input) && Array.isArray(input.recentMessages) ? input.recentMessages : []
  return items.flatMap((item, index) => {
    if (!isRecord(item)) {
      return []
    }
    const role = item.role === 'assistant' ? 'assistant' : 'user'
    const text = readText(item.text ?? item.content).trim()
    if (!text) {
      return []
    }
    return [{
      id: `sample-${index}`,
      role,
      content: [{ type: 'text' as const, text }],
      createdAt: new Date(Date.UTC(2026, 3, 30, 10, index)),
    }]
  })
}

function readCurrentUserMessage(input: unknown, fallback = '你还记得我喜欢的游戏吗？') {
  return isRecord(input) ? readText(input.currentUserMessage, fallback) : fallback
}

function readMemoryRecords(input: unknown, layer: 'short_term' | 'fixed'): MemoryRecord[] {
  const items = isRecord(input) && Array.isArray(input.memories) ? input.memories : [{
    detail: layer === 'short_term' ? '原文说明用户刚刚提到星河2是喜欢的游戏。' : '原文说明用户喜欢科幻即时战略游戏。',
    retrievalText: layer === 'short_term' ? '用户喜欢星河2。' : '用户喜欢科幻即时战略游戏。',
    importance: 0.7,
  }]

  return items.flatMap((item, index) => {
    if (!isRecord(item)) {
      return []
    }
    const detail = readText(item.detail ?? item.displaySummary ?? item.summary).trim()
    const retrievalText = readText(item.retrievalText ?? item.retrieval_text ?? detail).trim()
    if (!detail || !retrievalText) {
      return []
    }
    return [{
      id: `sample-memory-${index}`,
      agentId: 'sample-agent',
      sessionId: 'sample-session',
      layer,
      sourceText: retrievalText,
      detail,
      retrievalText,
      retrievalEmbedding: [],
      retrievalModel: 'sample',
      tags: [],
      importance: typeof item.importance === 'number' ? item.importance : 0.7,
      observedStartAt: item.observedStartAt ? new Date(String(item.observedStartAt)) : null,
      observedEndAt: item.observedEndAt ? new Date(String(item.observedEndAt)) : null,
      createdAt: item.createdAt ? new Date(String(item.createdAt)) : new Date('2026-04-30T10:00:00.000Z'),
    }]
  })
}

function readEmotionState(input: unknown) {
  const state = isRecord(input) && isRecord(input.state) ? input.state : {}
  return {
    mood: typeof state.mood === 'number' ? Math.min(1, Math.max(-1, state.mood)) : 0.15,
    energy: typeof state.energy === 'number' ? Math.min(1, Math.max(0, state.energy)) : 0.55,
    stress: typeof state.stress === 'number' ? Math.min(1, Math.max(0, state.stress)) : 0.25,
  }
}

function readRelationshipState(input: unknown): RelationshipDimensions {
  const state = isRecord(input) && isRecord(input.state) ? input.state : {}
  return {
    trust: typeof state.trust === 'number' ? Math.min(1, Math.max(0, state.trust)) : 0.55,
    affinity: typeof state.affinity === 'number' ? Math.min(1, Math.max(0, state.affinity)) : 0.5,
    familiarity: typeof state.familiarity === 'number' ? Math.min(1, Math.max(0, state.familiarity)) : 0.35,
    respect: typeof state.respect === 'number' ? Math.min(1, Math.max(0, state.respect)) : 0.6,
  }
}

function readCounterpart(input: unknown) {
  const counterpart = isRecord(input) && isRecord(input.counterpart) ? input.counterpart : {}
  return {
    id: readText(counterpart.id, 'sample-counterpart'),
    name: readText(counterpart.name, 'Lin'),
    role: readText(counterpart.role, '用户'),
    description: readText(counterpart.description, '正在调试虚拟人系统的人'),
    note: readText(counterpart.note, '喜欢直接指出系统问题'),
  }
}

function buildAnalysisInput(input: unknown, kind: 'emotion' | 'relationship') {
  const userMessage = isRecord(input) ? readText(input.userMessage, '你还记得我喜欢什么游戏吗？') : '你还记得我喜欢什么游戏吗？'
  const assistantReply = isRecord(input) ? readText(input.assistantReply, '你之前提到过星河2。') : '你之前提到过星河2。'
  if (kind === 'emotion') {
    return [
      '请分析这一轮已经完成的对话，应该如何改变这个 persona 的情绪状态。',
      '只输出严格 JSON。',
      '必须包含这些键：mood_delta、energy_delta、stress_delta、trigger。',
      '',
      `当前状态：${JSON.stringify(readEmotionState(input))}`,
      '基线状态：{"mood":0,"energy":0.5,"stress":0.2}',
      '每轮衰减：0.15',
      '',
      '用户消息：',
      userMessage,
      '',
      '助手回复：',
      assistantReply,
    ].join('\n')
  }
  const counterpart = readCounterpart(input)
  return [
    `请分析这一轮已经完成的对话，应该如何改变这个 persona 面向「${counterpart.name}」的关系状态。`,
    '只输出严格 JSON。',
    '必须包含这些键：trust_delta、affinity_delta、familiarity_delta、respect_delta、trigger。',
    '',
    `当前面对的对象：${counterpart.name}`,
    `当前状态：${JSON.stringify(readRelationshipState(input))}`,
    '基线状态：{"trust":0.5,"affinity":0.5,"familiarity":0.2,"respect":0.6}',
    '每轮衰减：0.1',
    '',
    '用户消息：',
    userMessage,
    '',
    '助手回复：',
    assistantReply,
  ].join('\n')
}

function buildContextSource(input: unknown) {
  const messages = readConversationMessages({
    recentMessages: isRecord(input) && Array.isArray(input.messages)
      ? input.messages
      : [
          { role: 'user', text: '我最近在玩星河2。' },
          { role: 'assistant', text: '这个我记住。' },
        ],
  })
  return buildContextToShortTermSourceText(messages)
}

function buildShortTermSource(input: unknown) {
  const memories = readMemoryRecords(input, 'short_term')
  return buildShortTermToLongTermSourceText(memories)
}

async function runLlmTest(input: {
  agent: AgentRecord
  mode: PromptTestMode
  testId: string
  model: string
  systemPrompt: string
  inputText: string
  responseFormat?: LLMRequest['responseFormat']
  parse: (raw: string) => unknown
  provider?: ProviderLike
}) {
  const provider = input.provider ?? createProvider(input.agent.provider)
  let response: LLMResponse
  try {
    response = await provider.sendMessage({
      model: input.model,
      systemPrompt: input.systemPrompt,
      messages: [{ role: 'user', content: [{ type: 'text', text: input.inputText }] }],
      reasoning: { effort: 'none' },
      responseFormat: input.responseFormat,
    })
  } catch (err) {
    return Response.json({
      testId: input.testId,
      mode: input.mode,
      model: input.model,
      systemPrompt: input.systemPrompt,
      inputText: input.inputText,
      error: err instanceof Error ? err.message : 'Prompt test provider failed',
    }, { status: 502 })
  }
  const rawOutput = extractText(response)

  return Response.json({
    testId: input.testId,
    mode: input.mode,
    model: input.model,
    systemPrompt: input.systemPrompt,
    inputText: input.inputText,
    rawOutput,
    parsedOutput: input.parse(rawOutput),
    usage: response.usage,
  })
}

function renderToolDescription(agent: AgentRecord, testId: string, prompt: string | null, input: unknown) {
  const locale = appSettingsRepo.getAppLocale()
  const toolName = isRecord(input)
    ? readText(input.toolName, testId.replace(/^tools\./, '').replace(/\.description$/, ''))
    : testId.replace(/^tools\./, '').replace(/\.description$/, '')
  const resolved = resolveAgentTools({
    tools: getDefaultTools(),
    modules: agent.modules,
    config: agent.tools ?? null,
    locale,
  })
  const item = resolved.catalog.find((tool) => tool.name === toolName)
  if (!item) {
    return Response.json({ error: `Unknown tool: ${toolName}` }, { status: 400 })
  }
  const description = prompt ?? item.effectiveDescription
  const renderedOutput = locale === 'en-US'
    ? [
      'Tool description preview for this turn:',
      `- ${toolName}: ${description}`,
      '',
      item.effectiveEnabled ? 'This tool is currently exposed to the main model.' : `This tool is not currently exposed to the main model.${item.unavailableReason ? ` Reason: ${item.unavailableReason}` : ''}`,
    ].join('\n')
    : [
      '当前这轮可用工具描述预览：',
      `- ${toolName}：${description}`,
      '',
      item.effectiveEnabled ? '该工具当前会暴露给主模型。' : `该工具当前不会暴露给主模型。${item.unavailableReason ? `原因：${item.unavailableReason}` : ''}`,
    ].join('\n')
  return Response.json({
    testId,
    mode: 'render',
    renderedOutput,
    parsedOutput: { toolName, effectiveEnabled: item.effectiveEnabled, effectiveDescription: description },
  })
}

function renderPromptTest(agent: AgentRecord, body: Required<Pick<PromptTestRunInput, 'testId'>> & PromptTestRunInput) {
  const testId = String(body.testId)
  const input = body.input
  const prompt = readPromptOverride(body.prompt)
  const locale = appSettingsRepo.getAppLocale()

  if (testId === 'emotion.fragment') {
    const renderedOutput = buildEmotionFragment(readEmotionState(input), prompt, locale)
    return Response.json({ testId, mode: 'render', renderedOutput })
  }
  if (testId === 'relationship.fragment' || testId === 'relationshipNamed.fragment') {
    const counterpart = readCounterpart(input)
    const renderedOutput = buildRelationshipFragment(readRelationshipState(input), prompt, counterpart.name, counterpart, locale)
    return Response.json({ testId, mode: 'render', renderedOutput })
  }
  if (testId === 'memory.shortTermFragment') {
    const renderedOutput = renderLayeredMemoryFragment({
      shortTermMemories: readMemoryRecords(input, 'short_term'),
      fixedMemories: [],
      shortTermPrompt: prompt,
      showNoHitMemoryFragments: true,
      locale,
    })
    return Response.json({ testId, mode: 'render', renderedOutput })
  }
  if (testId === 'memory.fixedFragment') {
    const renderedOutput = renderLayeredMemoryFragment({
      shortTermMemories: [],
      fixedMemories: readMemoryRecords(input, 'fixed'),
      fixedPrompt: prompt,
      showNoHitMemoryFragments: true,
      locale,
    })
    return Response.json({ testId, mode: 'render', renderedOutput })
  }
  if (testId === 'personality.systemPrompt') {
    const storedPrompt = readPersonalityPrompts(agent.modules, locale).systemPrompt
    return Response.json({ testId, mode: 'render', renderedOutput: prompt ?? (storedPrompt || `You are ${agent.name}.`) })
  }
  if (testId === 'personality.personaPrompt') {
    const renderedOutput = locale === 'en-US'
      ? (prompt ? `Additional role constraints: ${prompt}` : 'Additional role constraints: (empty)')
      : (prompt ? `角色额外约束：${prompt}` : '角色额外约束：（空）')
    return Response.json({ testId, mode: 'render', renderedOutput })
  }
  if (testId === 'personality.thinkingModePrompt') {
    const renderedOutput = locale === 'en-US'
      ? (prompt ? `Thinking-mode appended fragment:\n${prompt}` : 'Thinking-mode appended fragment: (empty, nothing appended)')
      : (prompt ? `思考模式追加片段：\n${prompt}` : '思考模式追加片段：（空，不追加）')
    return Response.json({ testId, mode: 'render', renderedOutput })
  }
  if (testId.startsWith('tools.') && testId.endsWith('.description')) {
    return renderToolDescription(agent, testId, prompt, input)
  }

  return Response.json({ error: `Prompt test ${testId} is not a render test` }, { status: 400 })
}

export async function runPromptTest(agentId: string, body: unknown, provider?: ProviderLike) {
  const agent = agentRepo.getAgent(agentId)
  if (!agent) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }
  if (!isRecord(body)) {
    return Response.json({ error: 'body must be an object' }, { status: 400 })
  }

  const testId = readText(body.testId).trim()
  if (!testId) {
    return Response.json({ error: 'testId is required' }, { status: 400 })
  }

  const input = body.input
  const prompt = readPromptOverride(body.prompt)
  const locale = appSettingsRepo.getAppLocale()

  if (
    testId.startsWith('personality.')
    || testId.endsWith('.fragment')
    || testId === 'memory.shortTermFragment'
    || testId === 'memory.fixedFragment'
    || (testId.startsWith('tools.') && testId.endsWith('.description'))
  ) {
    return renderPromptTest(agent, { testId, prompt: body.prompt, input })
  }

  if (testId.startsWith('memory.') && !isSqliteMemoryConfig(agent.modules?.memory)) {
    return Response.json({ error: 'Agent memory scheme must be sqlite' }, { status: 400 })
  }

  const memoryConfig = resolveMemorySqliteConfig(agent.modules?.memory, locale)
  const memorySettings = resolveMemoryPipelineSettings(agent.modules?.memory)
  const model = memoryConfig.summarizeModel ?? agent.model
  const actorLabels = resolveMemoryActorLabels({ agentId: agent.id, sessionId: 'sample-session', agentModules: agent.modules })

  if (testId === 'memory.semanticAnalyzer') {
    const currentUserMessage = readCurrentUserMessage(input)
    const semanticMessages: ConversationMessage[] = [
      ...readConversationMessages(input),
      {
        role: 'user',
        content: currentUserMessage,
        createdAt: new Date('2026-04-30T10:59:00.000Z'),
      },
    ]
    const inputText = buildSemanticAnalyzerInputText(
      semanticMessages,
      currentUserMessage,
      actorLabels,
      memoryConfig.semanticAnalyzerHistoryMessages,
    )
    return runLlmTest({
      agent,
      testId,
      mode: 'llm',
      model,
      systemPrompt: buildSemanticAnalyzerPrompt(prompt ?? memoryConfig.semanticAnalyzerPrompt ?? memoryConfig.retrievePrompt, locale),
      inputText,
      parse: parseJsonValue,
      provider,
    })
  }
  if (testId === 'memory.timeAnalyzer') {
    const currentUserMessage = readCurrentUserMessage(input, locale === 'en-US' ? 'What did I eat for dinner yesterday?' : '我昨天晚饭吃了什么？')
    const timeMessages: ConversationMessage[] = [
      ...readConversationMessages(input),
      {
        role: 'user',
        content: currentUserMessage,
        createdAt: new Date('2026-04-30T10:59:00.000Z'),
      },
    ]
    const inputText = buildTimeAnalyzerInputText(
      timeMessages,
      currentUserMessage,
      new Date('2026-04-30T11:00:00.000+02:00'),
      actorLabels,
      memoryConfig.semanticAnalyzerHistoryMessages,
      locale,
    )
    return runLlmTest({
      agent,
      testId,
      mode: 'llm',
      model,
      systemPrompt: buildTimeAnalyzerPrompt(prompt ?? memoryConfig.timeAnalyzerPrompt, locale),
      inputText,
      parse: parseJsonValue,
      provider,
    })
  }
  if (testId === 'memory.contextToShortTerm') {
    return runLlmTest({
      agent,
      testId,
      mode: 'llm',
      model,
      systemPrompt: buildContextToShortTermPrompt(prompt ?? memoryConfig.contextToShortTermPrompt, memorySettings.maxShortTermMemoriesPerFlush, locale),
      inputText: buildContextSource(input),
      responseFormat: MEMORY_BATCH_WRITE_RESPONSE_FORMAT,
      parse: (raw) => ({ memories: parseMemoryBatchWriteResponse(raw, memorySettings.maxShortTermMemoriesPerFlush) }),
      provider,
    })
  }
  if (testId === 'memory.entityMention') {
    return runLlmTest({
      agent,
      testId,
      mode: 'llm',
      model,
      systemPrompt: buildEntityMentionPrompt(prompt ?? memoryConfig.entityMentionPrompt, locale),
      inputText: readCurrentUserMessage(input),
      parse: (raw) => ({ mentions: parseEntityMentionResponse(raw) }),
      provider,
    })
  }
  if (testId === 'memory.episodicExtraction') {
    return runLlmTest({
      agent,
      testId,
      mode: 'llm',
      model,
      systemPrompt: buildEpisodicExtractionPrompt(prompt ?? memoryConfig.episodicExtractionPrompt, locale),
      inputText: buildShortTermSource(input),
      parse: (raw) => parseEpisodicExtractionResponse(raw),
      provider,
    })
  }
  if (testId === 'memory.entityResolution') {
    const inputText = JSON.stringify(isRecord(input) && 'candidates' in input ? input.candidates : [{
      local_entity_id: 'local-game-1',
      surface: '星河2',
      type: 'object',
      context_hint: '用户提到的游戏简称',
      candidates: [{
        entity_id: 'entity-sc2',
        canonical_name: '星河战术2',
        type: 'object',
        description: '用户喜欢的游戏',
      }],
    }], null, 2)
    return runLlmTest({
      agent,
      testId,
      mode: 'llm',
      model,
      systemPrompt: buildEntityResolutionPrompt(prompt ?? memoryConfig.entityResolutionPrompt, locale),
      inputText,
      parse: (raw) => ({ resolutions: parseEntityResolutionResponse(raw) }),
      provider,
    })
  }
  if (testId === 'emotion.analysis') {
    return runLlmTest({
      agent,
      testId,
      mode: 'llm',
      model: readModuleAnalysisModel(agent, 'emotion'),
      systemPrompt: buildEmotionAnalysisPrompt(prompt, locale),
      inputText: buildAnalysisInput(input, 'emotion'),
      parse: parseEmotionAnalysis,
      provider,
    })
  }
  if (testId === 'relationship.analysis' || testId === 'relationshipNamed.analysis') {
    return runLlmTest({
      agent,
      testId,
      mode: 'llm',
      model: readModuleAnalysisModel(agent, 'relationship'),
      systemPrompt: buildRelationshipAnalysisPrompt(prompt, locale),
      inputText: buildAnalysisInput(input, 'relationship'),
      parse: parseRelationshipAnalysis,
      provider,
    })
  }

  return Response.json({ error: `Unknown prompt test: ${testId}` }, { status: 400 })
}
