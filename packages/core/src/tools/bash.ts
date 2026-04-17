import { exec } from 'node:child_process'
import type { Tool, ToolCallOptions, ToolResult } from './types'
import { isAbortError, throwIfAborted } from '../utils/abort'

export const BashTool: Tool = {
  name: 'bash',
  description:
    'Execute a shell command and return its stdout and stderr. Use this to run programs, inspect files, or perform system operations.',
  inputSchema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The shell command to execute',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds (default: 30000)',
      },
    },
    required: ['command'],
  },

  async call(input: Record<string, unknown>, options?: ToolCallOptions): Promise<ToolResult> {
    const command = input.command as string
    const timeout = (input.timeout as number) ?? 30_000
    const signal = options?.signal

    throwIfAborted(signal)

    return new Promise((resolve) => {
      exec(command, { timeout, maxBuffer: 1024 * 1024, signal }, (error, stdout, stderr) => {
        if (isAbortError(error)) {
          resolve({
            output: 'Command aborted',
            isError: true,
            metadata: { command, aborted: true },
          })
          return
        }

        if (error && !stdout && !stderr) {
          resolve({
            output: `Error: ${error.message}`,
            isError: true,
            metadata: { command, exitCode: error.code },
          })
          return
        }

        const output = [stdout, stderr].filter(Boolean).join('\n---stderr---\n')
        resolve({
          output: output || '(no output)',
          isError: !!error,
          metadata: { command, exitCode: error?.code ?? 0 },
        })
      })
    })
  },
}
