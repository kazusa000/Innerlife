import { agentRepo } from '@mas/db'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export type EmotionModuleRecord = {
  scheme?: string
  baseline?: Record<string, unknown>
  decayPerTurn?: number
  analysisModel?: string | null
  fragmentPrompt?: string | null
  analysisPrompt?: string | null
}

export function readEmotionModule(
  modules: Record<string, unknown> | null | undefined,
): EmotionModuleRecord | null {
  const emotion = modules?.emotion
  if (typeof emotion === 'string') {
    return { scheme: emotion }
  }

  return isRecord(emotion) ? (emotion as EmotionModuleRecord) : null
}

export function readEmotionScheme(
  modules: Record<string, unknown> | null | undefined,
) {
  const emotion = readEmotionModule(modules)
  return typeof emotion?.scheme === 'string' ? emotion.scheme : null
}

export function getEmotionManagerMeta(agentId: string) {
  const agent = agentRepo.getAgent(agentId)
  if (!agent) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  const scheme = readEmotionScheme(agent.modules)

  return Response.json({
    agentId,
    scheme,
    supportedSchemes: ['dimensional'],
    configured: Boolean(scheme && scheme !== 'noop'),
  })
}
