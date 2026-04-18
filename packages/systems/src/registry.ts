import { HelloWorldSystem, NoopSystem } from './noop'
import type { AgentModules, AgentSystem, SystemRegistry } from './types'

export const systemRegistry: SystemRegistry = {
  debug: {
    noop: () => new NoopSystem('debug'),
    'hello-world': () => new HelloWorldSystem(),
  },
}

function resolveSchemeName(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (typeof record.scheme === 'string') {
      return record.scheme
    }
    if (typeof record.impl === 'string') {
      return record.impl
    }
  }

  return 'noop'
}

export function createSystems(modules: AgentModules): AgentSystem[] {
  if (!modules) {
    return []
  }

  return Object.entries(modules).flatMap(([type, value]) => {
    const schemes = systemRegistry[type]
    if (!schemes) {
      return []
    }

    const schemeName = resolveSchemeName(value)
    const factory = schemes[schemeName]
    if (!factory) {
      return []
    }

    const system = factory()
    if (schemeName === 'noop') {
      return []
    }

    return [system]
  })
}
