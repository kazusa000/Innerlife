import type { Tool } from './types'
import { BashTool } from './bash'
import { FileReadTool } from './file-read'
import { FileWriteTool } from './file-write'
import { WebFetchTool } from './web-fetch'

export const defaultTools: Tool[] = [
  BashTool,
  FileReadTool,
  FileWriteTool,
  WebFetchTool,
]
