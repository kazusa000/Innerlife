import {
  agentRepo,
  relationshipCounterpartRepo,
  relationshipRepo,
  sessionRelationshipBindingRepo,
  sessionRepo,
} from '@mas/db'
import {
  buildRelationshipAnalysisPrompt,
  buildRelationshipFragment,
} from '@mas/systems'
import { DEFAULT_RELATIONSHIP_BASELINE } from '../../../../../persona-modules'
import { readRelationshipModule } from '../handler'

type RelationshipBaseline = {
  trust: number
  affinity: number
  familiarity: number
  respect: number
}

type NamedMultiDimConfig = {
  scheme: 'named-multi-dim'
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

function normalizeNamedMultiDimConfig(module: unknown): NamedMultiDimConfig {
  const record = readRelationshipModule({ relationship: module })
  return {
    scheme: 'named-multi-dim',
    baseline: normalizeBaseline(record?.baseline),
    decayPerTurn: clampDecay(record?.decayPerTurn, undefined),
    analysisModel: readText(record?.analysisModel),
    fragmentPrompt: readText(record?.fragmentPrompt),
    analysisPrompt: readText(record?.analysisPrompt),
  }
}

function buildPayload(agentId: string, config: NamedMultiDimConfig, selectedCounterpartId?: string | null) {
  const counterparts = relationshipCounterpartRepo.listRelationshipCounterpartsByAgent(agentId)
  const selectedCounterpart = selectedCounterpartId
    ? counterparts.find((item) => item.id === selectedCounterpartId) ?? null
    : counterparts[0] ?? null
  const relationship = selectedCounterpart
    ? relationshipRepo.getRelationship(agentId, selectedCounterpart.id, 'named')
    : undefined

  return {
    agentId,
    scheme: 'named-multi-dim' as const,
    baseline: config.baseline,
    decayPerTurn: config.decayPerTurn ?? null,
    analysisModel: config.analysisModel,
    fragmentPrompt: config.fragmentPrompt,
    analysisPrompt: config.analysisPrompt,
    counterparts: counterparts.map((item) => ({
      id: item.id,
      name: item.name,
    })),
    selectedCounterpartId: selectedCounterpart?.id ?? null,
    selectedCounterpart: selectedCounterpart
      ? { id: selectedCounterpart.id, name: selectedCounterpart.name }
      : null,
    currentState: relationship?.dimensions ?? null,
    history: relationship?.history ?? [],
    fragmentPromptDefault: buildRelationshipFragment(
      relationship?.dimensions ?? config.baseline,
      null,
      selectedCounterpart?.name ?? '当前对象',
    ),
    fragmentPromptEffective: buildRelationshipFragment(
      relationship?.dimensions ?? config.baseline,
      config.fragmentPrompt,
      selectedCounterpart?.name ?? '当前对象',
    ),
    analysisPromptDefault: buildRelationshipAnalysisPrompt(),
    analysisPromptEffective: buildRelationshipAnalysisPrompt(config.analysisPrompt),
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

export function getNamedMultiDimRelationshipConfig(agentId: string, selectedCounterpartId?: string | null) {
  const agent = agentRepo.getAgent(agentId)
  if (!agent) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  const relationship = readRelationshipModule(agent.modules)
  if (relationship?.scheme !== 'named-multi-dim') {
    return Response.json(
      { error: 'Agent relationship scheme must be named-multi-dim' },
      { status: 400 },
    )
  }

  return Response.json(buildPayload(agentId, normalizeNamedMultiDimConfig(agent.modules?.relationship), selectedCounterpartId))
}

export function updateNamedMultiDimRelationshipConfig(agentId: string, body: unknown) {
  const agent = agentRepo.getAgent(agentId)
  if (!agent) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  const parsed = parsePatchBody(body)
  if (!parsed.ok) {
    return parsed.response
  }

  const current = normalizeNamedMultiDimConfig(agent.modules?.relationship)
  const next: NamedMultiDimConfig = {
    scheme: 'named-multi-dim',
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
    scheme: 'named-multi-dim',
    baseline: next.baseline,
    ...(typeof next.decayPerTurn === 'number' ? { decayPerTurn: next.decayPerTurn } : {}),
    ...(next.analysisModel ? { analysisModel: next.analysisModel } : {}),
    ...(next.fragmentPrompt ? { fragmentPrompt: next.fragmentPrompt } : {}),
    ...(next.analysisPrompt ? { analysisPrompt: next.analysisPrompt } : {}),
  }
  agentRepo.updateAgent(agentId, { modules: nextModules })

  return Response.json(buildPayload(agentId, next))
}

export function createNamedRelationshipCounterpart(agentId: string, body: unknown) {
  const agent = agentRepo.getAgent(agentId)
  if (!agent) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  if (!isRecord(body) || typeof body.name !== 'string' || !body.name.trim()) {
    return Response.json({ error: 'name must be a non-empty string' }, { status: 400 })
  }

  const counterpart = relationshipCounterpartRepo.createRelationshipCounterpart({
    agentId,
    name: body.name,
  })
  return Response.json({ counterpart })
}

export function renameNamedRelationshipCounterpart(agentId: string, counterpartId: string, body: unknown) {
  const counterpart = relationshipCounterpartRepo.getRelationshipCounterpart(counterpartId)
  if (!counterpart || counterpart.agentId !== agentId) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  if (!isRecord(body) || typeof body.name !== 'string' || !body.name.trim()) {
    return Response.json({ error: 'name must be a non-empty string' }, { status: 400 })
  }

  const updated = relationshipCounterpartRepo.updateRelationshipCounterpart(counterpartId, {
    name: body.name,
  })
  return Response.json({ counterpart: updated })
}

export function deleteNamedRelationshipCounterpart(agentId: string, counterpartId: string) {
  const counterpart = relationshipCounterpartRepo.getRelationshipCounterpart(counterpartId)
  if (!counterpart || counterpart.agentId !== agentId) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  relationshipRepo.deleteRelationshipsByCounterpart(agentId, counterpartId, 'named')
  sessionRelationshipBindingRepo.deleteSessionRelationshipBindingsByCounterpart(counterpartId)
  relationshipCounterpartRepo.deleteRelationshipCounterpart(counterpartId)
  return Response.json({ ok: true })
}

export function serializeSessionRelationshipCounterpart(sessionId: string) {
  const session = sessionRepo.getSession(sessionId)
  if (!session) {
    return Response.json({ error: 'Session not found' }, { status: 404 })
  }

  const binding = sessionRelationshipBindingRepo.getSessionRelationshipBinding(sessionId)
  const counterpart = binding
    ? relationshipCounterpartRepo.getRelationshipCounterpart(binding.counterpartId)
    : null

  return Response.json({
    sessionId,
    counterpart: counterpart
      ? {
          id: counterpart.id,
          name: counterpart.name,
        }
      : null,
  })
}

export function bindSessionRelationshipCounterpartForSession(sessionId: string, body: unknown) {
  const session = sessionRepo.getSession(sessionId)
  if (!session) {
    return Response.json({ error: 'Session not found' }, { status: 404 })
  }
  if (!isRecord(body) || typeof body.counterpartId !== 'string' || !body.counterpartId.trim()) {
    return Response.json({ error: 'counterpartId must be a non-empty string' }, { status: 400 })
  }

  const counterpart = relationshipCounterpartRepo.getRelationshipCounterpart(body.counterpartId)
  if (!counterpart || counterpart.agentId !== session.agentId) {
    return Response.json({ error: 'Counterpart not found' }, { status: 404 })
  }

  sessionRelationshipBindingRepo.bindSessionRelationshipCounterpart({
    sessionId,
    counterpartId: counterpart.id,
  })

  return Response.json({
    sessionId,
    counterpart: {
      id: counterpart.id,
      name: counterpart.name,
    },
  })
}

export function unbindSessionRelationshipCounterpartForSession(sessionId: string) {
  const session = sessionRepo.getSession(sessionId)
  if (!session) {
    return Response.json({ error: 'Session not found' }, { status: 404 })
  }
  sessionRelationshipBindingRepo.unbindSessionRelationshipCounterpart(sessionId)
  return Response.json({ ok: true })
}
