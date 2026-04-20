import { AnthropicProvider } from './anthropic'
import { OpenRouterProvider } from './openrouter'
import type { LLMProvider, ProviderName } from './types'

export function resolveProviderName(input: unknown): ProviderName {
  return input === 'openrouter' ? 'openrouter' : 'anthropic'
}

export function createProvider(providerName?: unknown): LLMProvider {
  switch (resolveProviderName(providerName)) {
    case 'openrouter':
      return new OpenRouterProvider()
    case 'anthropic':
    default:
      return new AnthropicProvider()
  }
}
