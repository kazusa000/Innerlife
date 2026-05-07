import { AnthropicProvider } from './anthropic'
import { OpenAICompatibleProvider } from './openai-compatible'
import { OpenRouterProvider } from './openrouter'
import type { LLMProvider, ProviderName } from './types'

export function resolveProviderName(input: unknown): ProviderName {
  if (input === 'openrouter' || input === 'openai-compatible') {
    return input
  }
  return 'anthropic'
}

export function createProvider(providerName?: unknown): LLMProvider {
  switch (resolveProviderName(providerName)) {
    case 'openrouter':
      return new OpenRouterProvider()
    case 'openai-compatible':
      return new OpenAICompatibleProvider()
    case 'anthropic':
    default:
      return new AnthropicProvider()
  }
}
