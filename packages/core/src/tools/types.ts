export interface ToolResult {
  output: string
  isError?: boolean
  metadata?: Record<string, unknown>
}

export interface ToolCallOptions {
  signal?: AbortSignal
}

export interface Tool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  call(input: Record<string, unknown>, options?: ToolCallOptions): Promise<ToolResult>
  isEnabled?(): boolean
}
