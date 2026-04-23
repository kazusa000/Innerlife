import { isSqliteMemoryConfig } from '@mas/systems'
import type { AgentToolsConfig, BuiltInToolName, Tool } from './types'

export interface ResolvedToolCatalogItem {
  name: string
  defaultEnabled: boolean
  configuredEnabled: boolean
  effectiveEnabled: boolean
  defaultDescription: string
  overrideDescription: string | null
  effectiveDescription: string
  unavailableReason: string | null
}

export interface ResolveAgentToolsInput {
  tools: Tool[]
  modules?: Record<string, unknown> | null
  config?: Record<string, unknown> | null
}

export interface ResolvedAgentTools {
  catalog: ResolvedToolCatalogItem[]
  effectiveTools: Tool[]
  systemPrompt: string
}

const defaultEnabledByTool: Record<BuiltInToolName, boolean> = {
  search_long_term_memory: true,
  web_fetch: false,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function normalizeAgentToolsConfig(config: Record<string, unknown> | null | undefined): AgentToolsConfig | undefined {
  if (!isRecord(config)) {
    return undefined
  }

  const normalized: AgentToolsConfig = {}

  for (const toolName of Object.keys(defaultEnabledByTool) as BuiltInToolName[]) {
    const rawEntry = config[toolName]
    if (!isRecord(rawEntry)) {
      continue
    }

    const entry: { enabled?: boolean; description?: string } = {}
    if (typeof rawEntry.enabled === 'boolean') {
      entry.enabled = rawEntry.enabled
    }

    if (typeof rawEntry.description === 'string' && rawEntry.description.trim()) {
      entry.description = rawEntry.description.trim()
    }

    if (entry.enabled !== undefined || entry.description !== undefined) {
      normalized[toolName] = entry
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined
}

function resolveToolAvailability(
  tool: Tool,
  modules?: Record<string, unknown> | null,
): string | null {
  if (tool.name === 'search_long_term_memory' && !isSqliteMemoryConfig(modules?.memory)) {
    return '仅当记忆方案为 sqlite 时才可生效。'
  }

  if (tool.isEnabled && !tool.isEnabled()) {
    return '工具当前不可用。'
  }

  return null
}

function cloneToolWithDescription(tool: Tool, description: string): Tool {
  return {
    ...tool,
    description,
  }
}

function buildToolSystemPrompt(catalog: ResolvedToolCatalogItem[]): string {
  const effectiveTools = catalog.filter((tool) => tool.effectiveEnabled)

  if (effectiveTools.length === 0) {
    return '当前这轮没有可用工具，直接基于已有上下文回答。'
  }

  return [
    '当前这轮可用工具如下。只有在确实需要时才调用；拿到工具结果后，继续完成本轮回复。',
    ...effectiveTools.map((tool) => `- ${tool.name}：${tool.effectiveDescription}`),
  ].join('\n')
}

export function resolveAgentTools(input: ResolveAgentToolsInput): ResolvedAgentTools {
  const config = normalizeAgentToolsConfig(input.config)
  const catalog = input.tools.map((tool) => {
    const builtInName = tool.name as BuiltInToolName
    const defaultEnabled = defaultEnabledByTool[builtInName] ?? false
    const override = config?.[builtInName]
    const configuredEnabled = override?.enabled ?? defaultEnabled
    const overrideDescription = override?.description ?? null
    const effectiveDescription = overrideDescription ?? tool.description
    const unavailableReason = resolveToolAvailability(tool, input.modules)
    const effectiveEnabled = configuredEnabled && unavailableReason === null

    return {
      name: tool.name,
      defaultEnabled,
      configuredEnabled,
      effectiveEnabled,
      defaultDescription: tool.description,
      overrideDescription,
      effectiveDescription,
      unavailableReason,
    }
  })

  const catalogByName = new Map(catalog.map((item) => [item.name, item]))
  const effectiveTools = input.tools
    .filter((tool) => catalogByName.get(tool.name)?.effectiveEnabled)
    .map((tool) => cloneToolWithDescription(
      tool,
      catalogByName.get(tool.name)?.effectiveDescription ?? tool.description,
    ))

  return {
    catalog,
    effectiveTools,
    systemPrompt: buildToolSystemPrompt(catalog),
  }
}
