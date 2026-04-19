import { AnthropicProvider, type LLMProvider, type Message, type RunAgentObserver } from '@mas/core'
import { agentRepo, memoryRepo } from '@mas/db'
import {
  buildMemoryConsolidationPrompt,
  buildMemoryConsolidationSourceText,
  isSqliteMemoryConfig,
  parseMemoryConsolidationResponse,
  resolveMemorySqliteConfig,
} from '@mas/systems'

export interface ConsolidateSqliteMemoriesDeps {
  provider?: Pick<LLMProvider, 'sendMessage'>
  resolveObserver?: (input: {
    agentId: string
    memories: ReturnType<typeof memoryRepo.listMemoriesByAgentOldestFirst>
    messages: Message[]
    model: string
    systemPrompt: string
  }) => RunAgentObserver | undefined
}

export async function consolidateSqliteMemories(
  agentId: string,
  deps: ConsolidateSqliteMemoriesDeps = {},
) {
  const agent = agentRepo.getAgent(agentId)
  if (!agent) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  const memoryConfig = agent.modules?.memory
  if (!isSqliteMemoryConfig(memoryConfig)) {
    return Response.json({ error: 'Agent memory scheme must be sqlite' }, { status: 400 })
  }

  const memories = memoryRepo.listMemoriesByAgentOldestFirst(agentId)
  if (memories.length === 0) {
    return Response.json({ error: 'No memories to consolidate' }, { status: 400 })
  }

  if (memories.length > 100) {
    return Response.json({ error: 'Too many memories to consolidate at once' }, { status: 400 })
  }

  const provider = deps.provider ?? new AnthropicProvider()
  const model = resolveMemorySqliteConfig(memoryConfig).summarizeModel ?? agent.model
  const systemPrompt = buildMemoryConsolidationPrompt()
  const phaseMetadata = { phase: 'consolidate' as const }
  const messages: Message[] = [
    {
      role: 'user',
      content: [{ type: 'text', text: buildMemoryConsolidationSourceText(memories) }],
    },
  ]
  const observer = deps.resolveObserver?.({
    agentId,
    memories,
    messages,
    model,
    systemPrompt,
  })
  const callId = observer?.onLLMCallStart({
    kind: 'memory',
    model,
    systemPrompt,
    tools: [],
    messages,
  })

  try {
    const response = await provider.sendMessage({
      model,
      systemPrompt,
      messages,
    })
    const actions = parseMemoryConsolidationResponse(
      response.content
        .map((block) =>
          block.type === 'text' && typeof block.text === 'string' ? block.text : JSON.stringify(block),
        )
        .join('\n'),
    )
    const report = memoryRepo.applyConsolidationPlan({
      agentId,
      actions,
    })

    if (callId !== undefined && observer) {
      observer.onLLMCallEnd(callId, {
        response: response.content,
        stopReason: response.stopReason,
        usage: response.usage,
        metadata: {
          ...phaseMetadata,
          report,
        },
      })
    }

    return Response.json(report)
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))

    if (callId !== undefined && observer) {
      observer.onLLMCallEnd(callId, {
        response: [],
        stopReason: 'end_turn',
        usage: { inputTokens: 0, outputTokens: 0 },
        metadata: phaseMetadata,
        error: err.message,
      })
    }

    return Response.json({ error: err.message }, { status: 500 })
  }
}
