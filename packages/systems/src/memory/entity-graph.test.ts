import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildEntityMentionPrompt,
  parseEntityMentionResponse,
  parseEntityResolutionResponse,
  parseEpisodicExtractionResponse,
} from './entity-graph'

test('entity mention prompt forbids graph mutation during chat recall', () => {
  const prompt = buildEntityMentionPrompt()
  assert.match(prompt, /不要创建实体/)
  assert.match(prompt, /不要合并实体/)
  assert.match(prompt, /不要新增 alias/)
  assert.match(prompt, /最多 5 个/)
  assert.match(prompt, /可能指向记忆节点/)
  assert.match(prompt, /person\/place\/object\/event/)
  assert.doesNotMatch(prompt, /project/)
  assert.doesNotMatch(prompt, /unknown/)
})

test('parseEntityMentionResponse accepts typed mentions with context hints', () => {
  const parsed = parseEntityMentionResponse(JSON.stringify({
    mentions: [
      {
        surface: '那家旧书店',
        type: 'place',
        context_hint: '用户追问先前提到的旧书店地点',
        confidence: 0.86,
      },
      {
        surface: '情绪',
        type: 'concept',
        context_hint: '抽象概念，第一版不应保留',
        confidence: 0.9,
      },
    ],
  }))

  assert.deepEqual(parsed, [
    {
      surface: '那家旧书店',
      type: 'place',
      contextHint: '用户追问先前提到的旧书店地点',
      confidence: 0.86,
    },
  ])
})

test('parseEntityMentionResponse tolerates top-level arrays and common real-model field variants', () => {
  const parsed = parseEntityMentionResponse(`
\`\`\`json
[
  {
    "name": "旧书店",
    "type": "place",
    "context": "用户用泛称追问一个可能指向记忆节点的地点",
    "score": 0.9
  },
  {
    "mention": "memory v2",
    "type": "project",
    "context_hint": "用户追问的项目名",
    "confidence": 0.8
  }
]
\`\`\`
  `)

  assert.deepEqual(parsed, [
    {
      surface: '旧书店',
      type: 'place',
      contextHint: '用户用泛称追问一个可能指向记忆节点的地点',
      confidence: 0.9,
    },
    {
      surface: 'memory v2',
      type: 'object',
      contextHint: '用户追问的项目名',
      confidence: 0.8,
    },
  ])
})

test('entity parsers narrow obsolete project and unknown types away', () => {
  const mentions = parseEntityMentionResponse(JSON.stringify({
    mentions: [
      { surface: '星际争霸2', type: 'project', context_hint: '游戏名', confidence: 0.9 },
      { surface: '含糊对象', type: 'unknown', context_hint: '不应保留 unknown', confidence: 0.9 },
    ],
  }))
  const extraction = parseEpisodicExtractionResponse(JSON.stringify({
    entities: [
      { local_entity_id: 'e1', surface: '魔兽世界', type: 'project', context_hint: '游戏名' },
      { local_entity_id: 'e2', surface: '上周测试', type: 'unknown', context_hint: '事件' },
    ],
    episodic_memories: [
      {
        summary: '用户提到魔兽世界和上周测试。',
        source_quote: '魔兽世界和上周测试',
        importance: 0.7,
        entity_links: [
          { local_entity_id: 'e1', weight: 0.9 },
          { local_entity_id: 'e2', weight: 0.8 },
        ],
      },
    ],
  }))
  const resolutions = parseEntityResolutionResponse(JSON.stringify({
    resolutions: [
      {
        local_entity_id: 'e1',
        action: 'create_new',
        canonical_name: 'memory v2',
        type: 'project',
        confidence: 0.8,
      },
      {
        local_entity_id: 'e2',
        action: 'create_new',
        canonical_name: '模糊实体',
        type: 'unknown',
        confidence: 0.8,
      },
    ],
  }))

  assert.deepEqual(mentions.map((mention) => mention.type), ['object'])
  assert.deepEqual(extraction.entities.map((entity) => entity.type), ['object', 'object'])
  assert.deepEqual(resolutions.map((resolution) => resolution.action === 'create_new' ? resolution.type : null), ['object', 'object'])
})

test('parseEpisodicExtractionResponse enforces max links and drops weak links', () => {
  const parsed = parseEpisodicExtractionResponse(JSON.stringify({
    entities: [
      { local_entity_id: 'e1', surface: 'WJJ', type: 'person', context_hint: '当前对话对象', aliases: [] },
      { local_entity_id: 'e2', surface: '旧书店', type: 'place', context_hint: '地点', aliases: ['那家书店'] },
      { local_entity_id: 'e3', surface: '海盐焦糖', type: 'object', context_hint: '物品', aliases: [] },
      { local_entity_id: 'e4', surface: '雨天', type: 'event', context_hint: '事件背景', aliases: [] },
      { local_entity_id: 'e5', surface: '项目', type: 'project', context_hint: '项目', aliases: [] },
      { local_entity_id: 'e6', surface: '背景音乐', type: 'object', context_hint: '弱背景', aliases: [] },
    ],
    episodic_memories: [
      {
        summary: 'WJJ 在旧书店提到过海盐焦糖。',
        source_quote: '旧书店那次买了海盐焦糖',
        importance: 0.72,
        entity_links: [
          { local_entity_id: 'e1', weight: 0.8 },
          { local_entity_id: 'e2', weight: 1 },
          { local_entity_id: 'e3', weight: 0.7 },
          { local_entity_id: 'e4', weight: 0.4 },
          { local_entity_id: 'e5', weight: 0.3 },
          { local_entity_id: 'e6', weight: 0.2 },
        ],
      },
    ],
  }))

  assert.equal(parsed.entities.length, 6)
  assert.equal(parsed.episodicMemories[0]?.entityLinks.length, 5)
  assert.equal(parsed.episodicMemories[0]?.entityLinks.some((link) => link.localEntityId === 'e6'), false)
})

test('parseEntityResolutionResponse only merges above threshold', () => {
  const parsed = parseEntityResolutionResponse(JSON.stringify({
    resolutions: [
      {
        local_entity_id: 'e1',
        action: 'merge',
        entity_id: 'existing-1',
        confidence: 0.82,
        alias_to_add: '那家旧书店',
      },
      {
        local_entity_id: 'e2',
        action: 'merge',
        entity_id: 'existing-2',
        confidence: 0.7,
      },
      {
        local_entity_id: 'e3',
        action: 'create_new',
        canonical_name: '海盐焦糖',
        type: 'object',
        confidence: 0.78,
      },
    ],
  }))

  assert.deepEqual(parsed.map((item) => item.action), ['merge', 'create_new', 'create_new'])
  assert.equal(parsed[0]?.action === 'merge' ? parsed[0].aliasToAdd : null, '那家旧书店')
  assert.equal(parsed[1]?.localEntityId, 'e2')
})

test('parseEntityResolutionResponse tolerates prose-wrapped fenced arrays from real models', () => {
  const parsed = parseEntityResolutionResponse(`
根据分析，所有实体均为首次出现。

\`\`\`json
[
  {
    "local_entity_id": "e1",
    "action": "create_new",
    "global_entity_id": "WJJ",
    "type": "person",
    "description": "当前用户"
  },
  {
    "local_entity_id": "e2",
    "action": "create_new",
    "canonical_name": "安特卫普旧书店",
    "type": "place",
    "confidence": 0.84
  }
]
\`\`\`
  `)

  assert.deepEqual(parsed, [
    {
      localEntityId: 'e1',
      action: 'create_new',
      canonicalName: 'WJJ',
      type: 'person',
      confidence: 0.5,
    },
    {
      localEntityId: 'e2',
      action: 'create_new',
      canonicalName: '安特卫普旧书店',
      type: 'place',
      confidence: 0.84,
    },
  ])
})
