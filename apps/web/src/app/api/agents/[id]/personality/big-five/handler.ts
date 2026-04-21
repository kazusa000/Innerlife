import { agentRepo } from '@mas/db'
import {
  DEFAULT_BIG5,
  type BigFiveScores,
} from '../../../../../persona-modules'
import { readPersonalityModule } from '../handler'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

type BigFivePatchBody = {
  big5?: Partial<BigFiveScores>
  speechStyle?: string
  background?: string
  prompt?: string
}

type BigFiveConfig = {
  scheme: 'big-five'
  big5: BigFiveScores
  speechStyle: string
  background: string
  prompt: string
}

function clampTrait(value: unknown, fallback: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallback
  }

  return Math.min(1, Math.max(0, value))
}

function readText(value: unknown, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback
}

function normalizeBigFiveConfig(module: unknown): BigFiveConfig {
  const record = readPersonalityModule({ personality: module })

  return {
    scheme: 'big-five',
    big5: {
      openness: clampTrait(record?.big5?.openness, DEFAULT_BIG5.openness),
      conscientiousness: clampTrait(record?.big5?.conscientiousness, DEFAULT_BIG5.conscientiousness),
      extraversion: clampTrait(record?.big5?.extraversion, DEFAULT_BIG5.extraversion),
      agreeableness: clampTrait(record?.big5?.agreeableness, DEFAULT_BIG5.agreeableness),
      neuroticism: clampTrait(record?.big5?.neuroticism, DEFAULT_BIG5.neuroticism),
    },
    speechStyle: readText(record?.speechStyle),
    background: readText(record?.background),
    prompt: readText(record?.prompt),
  }
}

function readExistingBigFiveConfig(agentId: string) {
  const agent = agentRepo.getAgent(agentId)
  if (!agent) {
    return {
      agent: null,
      response: Response.json({ error: 'Not found' }, { status: 404 }),
    }
  }

  const personality = readPersonalityModule(agent.modules)
  if (personality?.scheme !== 'big-five') {
    return {
      agent,
      response: Response.json(
        { error: 'Agent personality scheme must be big-five' },
        { status: 400 },
      ),
    }
  }

  return {
    agent,
    response: null,
  }
}

function parsePatchBody(body: unknown) {
  if (!isRecord(body)) {
    return {
      ok: false as const,
      response: Response.json({ error: 'Request body must be an object' }, { status: 400 }),
    }
  }

  if (body.big5 !== undefined && !isRecord(body.big5)) {
    return {
      ok: false as const,
      response: Response.json({ error: 'big5 must be an object' }, { status: 400 }),
    }
  }

  if (body.speechStyle !== undefined && typeof body.speechStyle !== 'string') {
    return {
      ok: false as const,
      response: Response.json({ error: 'speechStyle must be a string' }, { status: 400 }),
    }
  }

  if (body.background !== undefined && typeof body.background !== 'string') {
    return {
      ok: false as const,
      response: Response.json({ error: 'background must be a string' }, { status: 400 }),
    }
  }

  if (body.prompt !== undefined && typeof body.prompt !== 'string') {
    return {
      ok: false as const,
      response: Response.json({ error: 'prompt must be a string' }, { status: 400 }),
    }
  }

  return {
    ok: true as const,
    value: body as BigFivePatchBody,
  }
}

export function getBigFivePersonalityConfig(agentId: string) {
  const existing = readExistingBigFiveConfig(agentId)
  if (existing.response) {
    return existing.response
  }

  const config = normalizeBigFiveConfig(existing.agent?.modules?.personality)

  return Response.json({
    agentId,
    scheme: 'big-five',
    big5: config.big5,
    speechStyle: config.speechStyle,
    background: config.background,
    prompt: config.prompt,
  })
}

export function updateBigFivePersonalityConfig(agentId: string, body: unknown) {
  const agent = agentRepo.getAgent(agentId)
  if (!agent) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  const parsed = parsePatchBody(body)
  if (!parsed.ok) {
    return parsed.response
  }

  const current = normalizeBigFiveConfig(agent.modules?.personality)
  const next: BigFiveConfig = {
    scheme: 'big-five',
    big5: {
      openness: clampTrait(parsed.value.big5?.openness, current.big5.openness),
      conscientiousness: clampTrait(
        parsed.value.big5?.conscientiousness,
        current.big5.conscientiousness,
      ),
      extraversion: clampTrait(parsed.value.big5?.extraversion, current.big5.extraversion),
      agreeableness: clampTrait(parsed.value.big5?.agreeableness, current.big5.agreeableness),
      neuroticism: clampTrait(parsed.value.big5?.neuroticism, current.big5.neuroticism),
    },
    speechStyle: parsed.value.speechStyle !== undefined
      ? parsed.value.speechStyle.trim()
      : current.speechStyle,
    background: parsed.value.background !== undefined
      ? parsed.value.background.trim()
      : current.background,
    prompt: parsed.value.prompt !== undefined
      ? parsed.value.prompt.trim()
      : current.prompt,
  }

  const nextModules = isRecord(agent.modules) ? { ...agent.modules } : {}
  nextModules.personality = next
  agentRepo.updateAgent(agentId, { modules: nextModules })

  return Response.json({
    agentId,
    scheme: 'big-five',
    big5: next.big5,
    speechStyle: next.speechStyle,
    background: next.background,
    prompt: next.prompt,
  })
}
