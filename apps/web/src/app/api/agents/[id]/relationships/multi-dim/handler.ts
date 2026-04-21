import { agentRepo, relationshipRepo } from '@mas/db'
import { DEFAULT_RELATIONSHIP_BASELINE } from '../../../../../persona-modules'
import { readRelationshipModule } from '../handler'

const DEFAULT_COUNTERPART_ID = 'default-user'

type RelationshipBaseline = {
  trust: number
  affinity: number
  familiarity: number
  respect: number
}

type MultiDimConfig = {
  scheme: 'multi-dim'
  baseline: RelationshipBaseline
  decayPerTurn?: number
  analysisModel: string | null
  fragmentPrompt: string | null
  analysisPrompt: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function clampLevel(value: unknown, fallback: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallback
  }

  return Math.min(1, Math.max(0, value))
}

function clampDecay(value: unknown, fallback: number | undefined) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallback
  }

  return Math.min(1, Math.max(0, value))
}

function readText(value: unknown, fallback: string | null = null) {
  if (typeof value !== 'string') {
    return fallback
  }

  const trimmed = value.trim()
  return trimmed ? trimmed : fallback
}

function normalizeBaseline(
  value: unknown,
  fallback: RelationshipBaseline = DEFAULT_RELATIONSHIP_BASELINE,
): RelationshipBaseline {
  const record = isRecord(value) ? value : {}
  return {
    trust: clampLevel(record.trust, fallback.trust),
    affinity: clampLevel(record.affinity, fallback.affinity),
    familiarity: clampLevel(record.familiarity, fallback.familiarity),
    respect: clampLevel(record.respect, fallback.respect),
  }
}

function normalizeMultiDimConfig(module: unknown): MultiDimConfig {
  const record = readRelationshipModule({ relationship: module })
  return {
    scheme: 'multi-dim',
    baseline: normalizeBaseline(record?.baseline),
    decayPerTurn: clampDecay(record?.decayPerTurn, undefined),
    analysisModel: readText(record?.analysisModel),
    fragmentPrompt: readText(record?.fragmentPrompt),
    analysisPrompt: readText(record?.analysisPrompt),
  }
}

function buildPayload(agentId: string, config: MultiDimConfig) {
  const relationship = relationshipRepo.getRelationship(agentId, DEFAULT_COUNTERPART_ID)
  return {
    agentId,
    scheme: 'multi-dim' as const,
    baseline: config.baseline,
    decayPerTurn: config.decayPerTurn ?? null,
    analysisModel: config.analysisModel,
    fragmentPrompt: config.fragmentPrompt,
    analysisPrompt: config.analysisPrompt,
    currentState: relationship?.dimensions ?? null,
    history: relationship?.history ?? [],
  }
}

function parsePatchBody(body: unknown) {
  if (!isRecord(body)) {
    return {
      ok: false as const,
      response: Response.json({ error: 'Request body must be an object' }, { status: 400 }),
    }
  }

  if (body.baseline !== undefined && !isRecord(body.baseline)) {
    return {
      ok: false as const,
      response: Response.json({ error: 'baseline must be an object' }, { status: 400 }),
    }
  }

  if (body.decayPerTurn !== undefined && typeof body.decayPerTurn !== 'number') {
    return {
      ok: false as const,
      response: Response.json({ error: 'decayPerTurn must be a number' }, { status: 400 }),
    }
  }

  if (body.analysisModel !== undefined && body.analysisModel !== null && typeof body.analysisModel !== 'string') {
    return {
      ok: false as const,
      response: Response.json({ error: 'analysisModel must be a string or null' }, { status: 400 }),
    }
  }

  if (body.fragmentPrompt !== undefined && body.fragmentPrompt !== null && typeof body.fragmentPrompt !== 'string') {
    return {
      ok: false as const,
      response: Response.json({ error: 'fragmentPrompt must be a string or null' }, { status: 400 }),
    }
  }

  if (body.analysisPrompt !== undefined && body.analysisPrompt !== null && typeof body.analysisPrompt !== 'string') {
    return {
      ok: false as const,
      response: Response.json({ error: 'analysisPrompt must be a string or null' }, { status: 400 }),
    }
  }

  return {
    ok: true as const,
    value: body as {
      baseline?: Partial<RelationshipBaseline>
      decayPerTurn?: number
      analysisModel?: string | null
      fragmentPrompt?: string | null
      analysisPrompt?: string | null
    },
  }
}

export function getMultiDimRelationshipConfig(agentId: string) {
  const agent = agentRepo.getAgent(agentId)
  if (!agent) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  const relationship = readRelationshipModule(agent.modules)
  if (relationship?.scheme !== 'multi-dim') {
    return Response.json(
      { error: 'Agent relationship scheme must be multi-dim' },
      { status: 400 },
    )
  }

  return Response.json(buildPayload(agentId, normalizeMultiDimConfig(agent.modules?.relationship)))
}

export function updateMultiDimRelationshipConfig(agentId: string, body: unknown) {
  const agent = agentRepo.getAgent(agentId)
  if (!agent) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  const parsed = parsePatchBody(body)
  if (!parsed.ok) {
    return parsed.response
  }

  const current = normalizeMultiDimConfig(agent.modules?.relationship)
  const next: MultiDimConfig = {
    scheme: 'multi-dim',
    baseline: {
      trust: clampLevel(parsed.value.baseline?.trust, current.baseline.trust),
      affinity: clampLevel(parsed.value.baseline?.affinity, current.baseline.affinity),
      familiarity: clampLevel(parsed.value.baseline?.familiarity, current.baseline.familiarity),
      respect: clampLevel(parsed.value.baseline?.respect, current.baseline.respect),
    },
    decayPerTurn: clampDecay(parsed.value.decayPerTurn, current.decayPerTurn),
    analysisModel:
      parsed.value.analysisModel !== undefined
        ? readText(parsed.value.analysisModel)
        : current.analysisModel,
    fragmentPrompt:
      parsed.value.fragmentPrompt !== undefined
        ? readText(parsed.value.fragmentPrompt)
        : current.fragmentPrompt,
    analysisPrompt:
      parsed.value.analysisPrompt !== undefined
        ? readText(parsed.value.analysisPrompt)
        : current.analysisPrompt,
  }

  const nextModules = isRecord(agent.modules) ? { ...agent.modules } : {}
  nextModules.relationship = {
    scheme: 'multi-dim',
    baseline: next.baseline,
    ...(typeof next.decayPerTurn === 'number' ? { decayPerTurn: next.decayPerTurn } : {}),
    ...(next.analysisModel ? { analysisModel: next.analysisModel } : {}),
    ...(next.fragmentPrompt ? { fragmentPrompt: next.fragmentPrompt } : {}),
    ...(next.analysisPrompt ? { analysisPrompt: next.analysisPrompt } : {}),
  }
  agentRepo.updateAgent(agentId, { modules: nextModules })

  return Response.json(buildPayload(agentId, next))
}
