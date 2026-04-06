import type { Tool, ToolResult } from './types'
import type { ToolDefinition, ToolUseBlock } from '../types'

export function toolsToDefinitions(tools: Tool[]): ToolDefinition[] {
  return tools
    .filter((t) => !t.isEnabled || t.isEnabled())
    .map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    }))
}

export async function executeTool(
  tools: Tool[],
  toolCall: ToolUseBlock,
): Promise<ToolResult> {
  const tool = tools.find((t) => t.name === toolCall.name)
  if (!tool) {
    return { output: `Unknown tool: ${toolCall.name}`, isError: true }
  }
  try {
    return await tool.call(toolCall.input)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { output: `Tool execution error: ${message}`, isError: true }
  }
}
