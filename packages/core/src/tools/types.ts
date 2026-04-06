export interface ToolResult {
  output: string
  isError?: boolean
  metadata?: Record<string, unknown>
}

export interface Tool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  call(input: Record<string, unknown>): Promise<ToolResult>
  isEnabled?(): boolean
}
