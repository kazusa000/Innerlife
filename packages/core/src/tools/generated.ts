import type { Tool } from './types'
import { WebFetchTool } from './web-fetch'

export const defaultTools: Tool[] = [
  WebFetchTool,
]
