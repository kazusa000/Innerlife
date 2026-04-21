import { agentRepo } from '@mas/db'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export type PersonalityModuleRecord = {
  scheme?: string
  big5?: Record<string, unknown>
  speechStyle?: string
  background?: string
  prompt?: string
}

export function readPersonalityModule(
  modules: Record<string, unknown> | null | undefined,
): PersonalityModuleRecord | null {
  const personality = modules?.personality
  if (typeof personality === 'string') {
    return { scheme: personality }
  }

  return isRecord(personality) ? (personality as PersonalityModuleRecord) : null
}

export function readPersonalityScheme(
  modules: Record<string, unknown> | null | undefined,
) {
  const personality = readPersonalityModule(modules)
  return typeof personality?.scheme === 'string' ? personality.scheme : null
}

export function getPersonalityManagerMeta(agentId: string) {
  const agent = agentRepo.getAgent(agentId)
  if (!agent) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  const scheme = readPersonalityScheme(agent.modules)

  return Response.json({
    agentId,
    scheme,
    supportedSchemes: ['big-five'],
    configured: Boolean(scheme && scheme !== 'noop'),
  })
}
