import { agentRepo } from '@mas/db'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export type RelationshipModuleRecord = {
  scheme?: string
  baseline?: Record<string, unknown>
  decayPerTurn?: number
  analysisModel?: string | null
}

export function readRelationshipModule(
  modules: Record<string, unknown> | null | undefined,
): RelationshipModuleRecord | null {
  const relationship = modules?.relationship
  if (typeof relationship === 'string') {
    return { scheme: relationship }
  }

  return isRecord(relationship) ? (relationship as RelationshipModuleRecord) : null
}

export function readRelationshipScheme(
  modules: Record<string, unknown> | null | undefined,
) {
  const relationship = readRelationshipModule(modules)
  return typeof relationship?.scheme === 'string' ? relationship.scheme : null
}

export function getRelationshipManagerMeta(agentId: string) {
  const agent = agentRepo.getAgent(agentId)
  if (!agent) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  const scheme = readRelationshipScheme(agent.modules)

  return Response.json({
    agentId,
    scheme,
    supportedSchemes: ['multi-dim'],
    configured: Boolean(scheme && scheme !== 'noop'),
  })
}
