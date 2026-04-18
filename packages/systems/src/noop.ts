import type { AgentSystem } from './types'

export class NoopSystem implements AgentSystem {
  name: string
  type: string

  constructor(type: string) {
    this.type = type
    this.name = `${type}:noop`
  }
}

export class HelloWorldSystem implements AgentSystem {
  name = 'debug:hello-world'
  type = 'debug'

  async beforeLLM(ctx: import('./types').TurnContext): Promise<void> {
    ctx.promptFragments.push({
      source: this.name,
      priority: 100,
      content: '(Debug: hello from system)',
    })
  }
}
