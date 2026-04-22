import type { Tool } from './types'
import { SearchLongTermMemoryTool } from './search-long-term-memory'
import { WebFetchTool } from './web-fetch'

export const defaultTools: Tool[] = [
  SearchLongTermMemoryTool,
  WebFetchTool,
]
