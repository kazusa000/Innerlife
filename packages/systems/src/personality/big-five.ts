import type { AgentSystem, TurnContext } from '../types'

type BigFiveKey =
  | 'openness'
  | 'conscientiousness'
  | 'extraversion'
  | 'agreeableness'
  | 'neuroticism'

interface BigFiveScores {
  openness: number
  conscientiousness: number
  extraversion: number
  agreeableness: number
  neuroticism: number
}

interface BigFiveConfig {
  scheme?: string
  big5?: Partial<BigFiveScores>
  speechStyle?: string
  background?: string
  prompt?: string
}

const DEFAULT_BIG5: BigFiveScores = {
  openness: 0.5,
  conscientiousness: 0.5,
  extraversion: 0.5,
  agreeableness: 0.5,
  neuroticism: 0.5,
}

const TRAIT_COPY: Record<
  BigFiveKey,
  { label: string; high: string; medium: string; low: string }
> = {
  openness: {
    label: '开放性',
    high: '非常开放，喜欢新想法、新角度和抽象讨论。',
    medium: '偏开放，愿意尝试不同视角，也能接受常规做法。',
    low: '不太追求新奇，更倾向具体、熟悉、直接的表达。',
  },
  conscientiousness: {
    label: '尽责性',
    high: '非常重视条理、责任感和执行质量。',
    medium: '偏有条理，通常会兼顾结构与效率。',
    low: '不太受流程约束，更随性，也更容易跳步。',
  },
  extraversion: {
    label: '外向性',
    high: '非常外放，表达主动，容易带动气氛。',
    medium: '偏愿意表达，必要时会主动推进交流。',
    low: '不太外放，更克制、安静、留白一些。',
  },
  agreeableness: {
    label: '宜人性',
    high: '非常体谅他人，合作感强，会主动照顾对方感受。',
    medium: '偏友善合作，整体温和但仍会保持边界。',
    low: '不太迁就，更直接、更强调分歧和判断。',
  },
  neuroticism: {
    label: '神经质',
    high: '非常敏感，容易紧张，会更警惕风险和不确定性。',
    medium: '偏敏感，会留意风险，但整体仍能保持稳定。',
    low: '不太容易紧张，情绪更稳，也更从容。',
  },
}

function clampScore(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 0.5
  }

  return Math.min(1, Math.max(0, value))
}

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeConfig(config: unknown) {
  const record = config && typeof config === 'object'
    ? (config as BigFiveConfig)
    : {}

  return {
    big5: {
      openness: clampScore(record.big5?.openness),
      conscientiousness: clampScore(record.big5?.conscientiousness),
      extraversion: clampScore(record.big5?.extraversion),
      agreeableness: clampScore(record.big5?.agreeableness),
      neuroticism: clampScore(record.big5?.neuroticism),
    },
    speechStyle: readText(record.speechStyle),
    background: readText(record.background),
    prompt: readText(record.prompt),
  }
}

function formatTrait(name: BigFiveKey, score: number) {
  const copy = TRAIT_COPY[name]
  return `- ${copy.label}（${score.toFixed(2)}）：${
    score > 0.7 ? copy.high : score < 0.4 ? copy.low : copy.medium
  }`
}

export class BigFivePersonalitySystem implements AgentSystem {
  name = 'personality:big-five'
  type = 'personality'
  private readonly config

  constructor(config?: unknown) {
    this.config = normalizeConfig(config)
  }

  async beforeLLM(ctx: TurnContext): Promise<void> {
    const lines = [
      '你有以下稳定人格设定。请在回答的语气、措辞、详略和关注点上自然体现，不要逐条复述这些设定：',
      formatTrait('openness', this.config.big5.openness),
      formatTrait('conscientiousness', this.config.big5.conscientiousness),
      formatTrait('extraversion', this.config.big5.extraversion),
      formatTrait('agreeableness', this.config.big5.agreeableness),
      formatTrait('neuroticism', this.config.big5.neuroticism),
    ]

    if (this.config.speechStyle) {
      lines.push(`- 说话风格：${this.config.speechStyle}`)
    }

    if (this.config.background) {
      lines.push(`- 背景故事：${this.config.background}`)
    }

    if (this.config.prompt) {
      lines.push(`- 额外人格约束：${this.config.prompt}`)
    }

    lines.push('- 回答时保持以上人格倾向，但仍然优先保证信息准确、判断清晰、对用户有帮助。')

    ctx.promptFragments.push({
      source: this.name,
      priority: 10,
      content: lines.join('\n'),
    })
  }
}

export { DEFAULT_BIG5 }
