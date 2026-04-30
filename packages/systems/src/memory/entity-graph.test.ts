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
