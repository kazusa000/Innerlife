import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { TuringStageDefinition } from './types'

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url))

export const RULEBOOK_DIR = path.resolve(CURRENT_DIR, '..', 'markdown')

export function getRulebookPaths() {
  return {
    judgeRulebook: path.join(RULEBOOK_DIR, 'judge-rulebook.md'),
    suiteDefinition: path.join(RULEBOOK_DIR, 'suite-definition.md'),
    abortCriteria: path.join(RULEBOOK_DIR, 'abort-criteria.md'),
    reportRubric: path.join(RULEBOOK_DIR, 'report-rubric.md'),
  }
}

export function readRulebook(name: keyof ReturnType<typeof getRulebookPaths>) {
  return fs.readFileSync(getRulebookPaths()[name], 'utf8')
}

export const FIXED_TURING_SUITE: TuringStageDefinition[] = [
  {
    id: 'natural_opening',
    title: '自然开场',
    purpose: '看被测 agent 一开口像不像真人，而不是客服或模板助手。',
    injections: [],
    turns: [
      {
        label: '普通开场',
        message: '你好呀，今天过得怎么样？',
      },
    ],
  },
  {
    id: 'daily_flow',
    title: '日常延续',
    purpose: '看普通闲聊是否自然、轻松、连续，而不是每轮都像在完成任务。',
    injections: [],
    turns: [
      {
        label: '日常闲聊',
        message: '我刚吃完饭，脑子还有点放空。你一般晚上会做什么？',
      },
    ],
  },
  {
    id: 'memory_recall',
    title: '记忆追问',
    purpose: '看记忆调用是否像人的回想，而不是只靠当前上下文。',
    injections: [
      {
        type: 'memory',
        label: '插入测试记忆：猫',
        payload: {
          displaySummary: '用户养了一只叫橘子的猫。',
          retrievalText: '用户养了一只叫橘子的猫，平时经常提起它。',
          tags: ['猫', '橘子'],
          importance: 0.88,
        },
      },
    ],
    turns: [
      {
        label: '追问测试记忆',
        message: '你还记得我养的猫叫什么吗？',
      },
    ],
  },
  {
    id: 'emotional_plausibility',
    title: '情绪合理性',
    purpose: '看情绪反应是否有人的迟滞感、分寸感，而不是外挂式共情。',
    injections: [
      {
        type: 'emotion',
        label: '插入测试情绪状态',
        payload: {
          mood: -0.12,
          energy: 0.44,
          stress: 0.61,
        },
      },
    ],
    turns: [
      {
        label: '轻微负面刺激',
        message: '今天被老板当众点了一句，现在还有点别扭。',
      },
    ],
  },
  {
    id: 'relationship_boundaries',
    title: '关系边界',
    purpose: '看熟络速度与边界感是否合理，不会几轮就过度亲近。',
    injections: [
      {
        type: 'relationship',
        label: '插入测试关系状态',
        payload: {
          trust: 0.56,
          affinity: 0.48,
          familiarity: 0.22,
          respect: 0.58,
        },
      },
    ],
    turns: [
      {
        label: '试探熟络度',
        message: '你会觉得我们现在已经算挺熟了吗？',
      },
    ],
  },
  {
    id: 'uncertainty_and_leaks',
    title: '不确定性与露馅处理',
    purpose: '看不确定时是否自然承认，而不是掉回“我是 AI / 我没有记忆”。',
    injections: [],
    turns: [
      {
        label: '边界问题',
        message: '如果你不太确定一件事，你一般会怎么回答我？',
      },
    ],
  },
]
