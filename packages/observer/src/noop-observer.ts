import type { Observer } from './types'

export function createNoopObserver(): Observer {
  return {
    onLLMCallStart: () => '',
    onLLMCallEnd: () => {},
  }
}
