import { readFile } from 'node:fs/promises'
import type { Tool, ToolResult } from './types'

const MAX_OUTPUT_BYTES = 100 * 1024

function truncateOutput(content: string): string {
  const size = Buffer.byteLength(content, 'utf8')
  if (size <= MAX_OUTPUT_BYTES) {
    return content
  }

  let end = content.length
  while (end > 0 && Buffer.byteLength(content.slice(0, end), 'utf8') > MAX_OUTPUT_BYTES) {
    end -= 1
  }

  const omitted = size - Buffer.byteLength(content.slice(0, end), 'utf8')
  return `${content.slice(0, end)}\n\n[truncated ${omitted} bytes]`
}

function errorResult(path: string, message: string): ToolResult {
  return {
    output: `Failed to read "${path}": ${message}`,
    isError: true,
    metadata: { path },
  }
}

export const FileReadTool: Tool = {
  name: 'file_read',
  description: 'Read the contents of a file from disk.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Absolute or relative path to the file to read',
      },
    },
    required: ['path'],
  },

  async call(input: Record<string, unknown>): Promise<ToolResult> {
    const path = typeof input.path === 'string' ? input.path.trim() : ''
    if (!path) {
      return errorResult('(missing path)', 'path is required')
    }

    try {
      const content = await readFile(path, 'utf8')
      return {
        output: truncateOutput(content),
        metadata: { path },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return errorResult(path, message)
    }
  },
}
