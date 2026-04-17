import { mkdir, writeFile, appendFile, access } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Tool, ToolResult } from './types'

type WriteMode = 'create' | 'overwrite' | 'append'

function errorResult(path: string, mode: WriteMode, message: string): ToolResult {
  return {
    output: `Failed to write "${path}" with mode "${mode}": ${message}`,
    isError: true,
    metadata: { path, mode },
  }
}

export const FileWriteTool: Tool = {
  name: 'file_write',
  description: 'Create, overwrite, or append text content to a file on disk.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Absolute or relative path to the file to write',
      },
      content: {
        type: 'string',
        description: 'Text content to write into the file',
      },
      mode: {
        type: 'string',
        enum: ['create', 'overwrite', 'append'],
        description: 'Write mode. Defaults to overwrite.',
      },
    },
    required: ['path', 'content'],
  },

  async call(input: Record<string, unknown>): Promise<ToolResult> {
    const path = typeof input.path === 'string' ? input.path.trim() : ''
    const content = typeof input.content === 'string' ? input.content : ''
    const mode = (input.mode as WriteMode | undefined) ?? 'overwrite'

    if (!path) {
      return errorResult('(missing path)', mode, 'path is required')
    }

    if (!['create', 'overwrite', 'append'].includes(mode)) {
      return errorResult(path, 'overwrite', `invalid mode "${String(input.mode)}"`)
    }

    try {
      await mkdir(dirname(path), { recursive: true })

      if (mode === 'create') {
        try {
          await access(path)
          return errorResult(path, mode, 'file already exists')
        } catch {
          await writeFile(path, content, 'utf8')
        }
      } else if (mode === 'append') {
        await appendFile(path, content, 'utf8')
      } else {
        await writeFile(path, content, 'utf8')
      }

      return {
        output: `Wrote ${content.length} characters to "${path}" with mode "${mode}".`,
        metadata: { path, mode, charsWritten: content.length },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return errorResult(path, mode, message)
    }
  },
}
