export type HomeAgentReference = {
  id: string
}

export type HomeAgentModuleState = {
  personaConfigured: boolean
  emotion: string
  relationship: string
  memory: string
}

export function resolveSelectedAgentId(
  agents: HomeAgentReference[],
  currentId: string | null,
): string | null {
  if (currentId && agents.some((agent) => agent.id === currentId)) {
    return currentId
  }

  return agents[0]?.id ?? null
}

export function countConfiguredHomeModules(modules: HomeAgentModuleState): number {
  return [
    modules.personaConfigured,
    modules.emotion !== 'noop',
    modules.relationship !== 'noop',
    modules.memory !== 'noop',
  ].filter(Boolean).length
}
