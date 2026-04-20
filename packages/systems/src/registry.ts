import { SummaryCompactionSystem } from './compaction'
import { DimensionalEmotionSystem } from './emotion'
import { MemorySqliteSystem } from './memory'
import { HelloWorldSystem, NoopSystem } from './noop'
import { BigFivePersonalitySystem } from './personality'
import { MultiDimRelationshipSystem } from './relationship'
import type { AgentModules, AgentSystem, SystemRegistry } from './types'

export const systemRegistry: SystemRegistry = {
  compaction: {
    noop: () => new NoopSystem('compaction'),
    summary: () => new SummaryCompactionSystem(),
  },
  debug: {
    noop: () => new NoopSystem('debug'),
    'hello-world': () => new HelloWorldSystem(),
  },
  emotion: {
    noop: () => new NoopSystem('emotion'),
    dimensional: (config) => new DimensionalEmotionSystem(config),
  },
  memory: {
    noop: () => new NoopSystem('memory'),
    sqlite: (config) => new MemorySqliteSystem(config),
  },
  personality: {
    noop: () => new NoopSystem('personality'),
    'big-five': (config) => new BigFivePersonalitySystem(config),
  },
  relationship: {
    noop: () => new NoopSystem('relationship'),
    'multi-dim': (config) => new MultiDimRelationshipSystem(config),
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
    if (schemeName === 'noop') {
      return []
    }

    const factory = schemes[schemeName]
    if (!factory) {
      return []
    }

    const system = factory(value)
    return [system]
  })
}
