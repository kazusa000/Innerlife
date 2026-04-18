import type { AgentSystem, TurnContext } from '../types'

function readPriorities(config: unknown): string[] {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return []
  }

  const priorities = (config as { priorities?: unknown }).priorities
  if (!Array.isArray(priorities)) {
    return []
  }

  return priorities
    .filter((value): value is string => typeof value === 'string')
    .map(value => value.trim())
    .filter(Boolean)
}

function renderValuesFragment(priorities: string[]): string | null {
  if (priorities.length === 0) {
    return null
  }

  return [
    'Values (in priority order):',
    ...priorities.map((value, index) => `${index + 1}. ${value}`),
  ].join('\n')
}

export class ValuesPriorityListSystem implements AgentSystem {
  name = 'values:priority-list'
  type = 'values'

  private readonly priorities: string[]

  constructor(config?: unknown) {
    this.priorities = readPriorities(config)
  }

  async beforeLLM(ctx: TurnContext): Promise<void> {
    const content = renderValuesFragment(this.priorities)
    if (!content) {
      return
    }

    ctx.promptFragments.push({
      source: this.name,
      priority: 50,
      content,
    })
  }
}
