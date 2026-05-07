import { agentRepo, episodicMemoryGraphRepo, memoryRepo, sessionRepo } from '@mas/db'
import {
  createMemoryEmbedder,
  isSqliteMemoryConfig,
  resolveMemorySqliteConfig,
  type MemoryEmbedder,
} from '@mas/systems'

type EditDeps = {
  embedder?: MemoryEmbedder
}

type EntityType = 'person' | 'place' | 'object' | 'event'
type MemoryLayer = 'short_term' | 'long_term' | 'fixed'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readRequiredText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readOptionalText(value: unknown) {
  if (value === null || value === undefined) {
    return null
  }
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readProbability(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    return null
  }
  return value
}

function readLinkWeight(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0.3 || value > 1) {
    return null
  }
  return value
}

function readNonNegativeInt(value: unknown) {
  if (value === undefined || value === null) {
    return 0
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    return null
  }
  return value
}

function readDateOrNull(value: unknown) {
  if (value === null || value === undefined || value === '') {
    return null
  }
  if (typeof value !== 'string') {
    return undefined
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

function readEntityType(value: unknown): EntityType | null {
  return value === 'person' || value === 'place' || value === 'object' || value === 'event'
    ? value
    : null
}

function readMemoryLayer(value: unknown): MemoryLayer | null {
  return value === 'short_term' || value === 'long_term' || value === 'fixed'
    ? value
    : null
}

function readAliases(value: unknown) {
  if (!Array.isArray(value)) {
    return null
  }
  const aliases = [...new Set(value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean))]
  return aliases
}

function readEntityLinks(value: unknown) {
  if (!Array.isArray(value) || value.length > 5) {
    return null
  }

  const links: Array<{ entityId: string; weight: number }> = []
  for (const item of value) {
    if (!isRecord(item)) {
      return null
    }
    const entityId = readRequiredText(item.entityId)
    const weight = readLinkWeight(item.weight)
    if (!entityId || weight === null) {
      return null
    }
    links.push({ entityId, weight })
  }
  return links
}

function buildEntityEmbeddingText(input: {
  canonicalName: string
  type: EntityType
  description: string | null
  aliases: string[]
}) {
  return [
    `canonical_name: ${input.canonicalName}`,
    `type: ${input.type}`,
    input.description ? `description: ${input.description}` : null,
    input.aliases.length > 0 ? `aliases: ${input.aliases.join(', ')}` : null,
  ].filter(Boolean).join('\n')
}

function serializeDate(value: Date | null | undefined) {
  return value ? value.toISOString() : null
}

function serializeSqliteMemory(memoryId: string) {
  const memory = memoryRepo.getMemory(memoryId)
  return memory
    ? {
      id: memory.id,
      sessionId: memory.sessionId,
      layer: memory.layer,
      detail: memory.detail,
      retrievalText: memory.retrievalText,
      retrievalModel: memory.retrievalModel,
      hasEmbedding: memory.retrievalEmbedding.length > 0,
      embeddingDimensions: memory.retrievalEmbedding.length,
      importance: memory.importance,
      observedStartAt: serializeDate(memory.observedStartAt),
      observedEndAt: serializeDate(memory.observedEndAt),
      createdAt: memory.createdAt.toISOString(),
    }
    : null
}

function serializeEntity(entity: ReturnType<typeof episodicMemoryGraphRepo.listMemoryEntitiesByAgent>[number]) {
  return {
    id: entity.id,
    type: entity.type,
    canonicalName: entity.canonicalName,
    description: entity.description,
    confidence: entity.confidence,
    aliases: entity.aliases,
    episodicMemoryCount: entity.episodicMemoryCount,
    hasEmbedding: entity.embedding.length > 0,
    embeddingDimensions: entity.embedding.length,
    createdAt: entity.createdAt.toISOString(),
    lastSeenAt: serializeDate(entity.lastSeenAt),
  }
}

function serializeEpisodic(memory: episodicMemoryGraphRepo.EpisodicMemoryWithEntitiesRecord) {
  return {
    id: memory.id,
    sessionId: memory.sessionId,
    summary: memory.summary,
    detail: memory.detail,
    retrievalModel: memory.retrievalModel,
    hasEmbedding: memory.retrievalEmbedding.length > 0,
    embeddingDimensions: memory.retrievalEmbedding.length,
    importance: memory.importance,
    observedStartAt: serializeDate(memory.observedStartAt),
    observedEndAt: serializeDate(memory.observedEndAt),
    createdAt: memory.createdAt.toISOString(),
    entities: memory.entities.map((link) => ({
      id: link.entity.id,
      type: link.entity.type,
      canonicalName: link.entity.canonicalName,
      weight: link.weight,
    })),
  }
}

function getManagedEntity(agentId: string, entityId: string) {
  return episodicMemoryGraphRepo.listMemoryEntitiesByAgent(agentId).find((entity) => entity.id === entityId)
}

function assertOwnedEntities(agentId: string, links: Array<{ entityId: string; weight: number }>) {
  return links.every((link) => episodicMemoryGraphRepo.getEntity(link.entityId)?.agentId === agentId)
}

async function embedOne(embedder: MemoryEmbedder, text: string, model: string) {
  const vectors = await embedder.embed([text], { model, inputType: 'search_document' })
  const vector = vectors[0]?.filter((value) => typeof value === 'number' && Number.isFinite(value)) ?? []
  if (vector.length === 0) {
    throw new Error('Embedding provider returned an empty vector')
  }
  return vector
}

function validationError(message: string) {
  return Response.json({ error: message }, { status: 400 })
}

export async function editSqliteMemoryGraph(agentId: string, input: unknown, deps: EditDeps = {}) {
  const agent = agentRepo.getAgent(agentId)
  if (!agent) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  if (!isSqliteMemoryConfig(agent.modules?.memory)) {
    return Response.json({ error: 'Agent memory scheme must be sqlite' }, { status: 400 })
  }

  if (!isRecord(input)) {
    return validationError('Request body must be an object')
  }

  const action = readRequiredText(input.action)
  if (!action) {
    return validationError('action is required')
  }

  const memoryConfig = resolveMemorySqliteConfig(agent.modules?.memory)
  const embeddingModel = memoryConfig.embeddingModel
  const embedder = deps.embedder ?? createMemoryEmbedder(memoryConfig.embeddingProvider)

  try {
    if (action === 'sqliteMemory.update') {
      const memoryId = readRequiredText(input.memoryId)
      const layer = readMemoryLayer(input.layer)
      const detail = readRequiredText(input.detail)
      const retrievalText = readRequiredText(input.retrievalText)
      const importance = readProbability(input.importance)
      const observedStartAt = readDateOrNull(input.observedStartAt)
      const observedEndAt = readDateOrNull(input.observedEndAt)
      if (!memoryId || !layer || !detail || !retrievalText || importance === null || observedStartAt === undefined || observedEndAt === undefined) {
        return validationError('sqliteMemory.update requires memoryId, layer, detail, retrievalText, importance, observedStartAt and observedEndAt')
      }

      const embedding = await embedOne(embedder, retrievalText, embeddingModel)
      const updated = memoryRepo.updateSqliteMemoryByAgent({
        agentId,
        memoryId,
        layer,
        detail,
        retrievalText,
        retrievalEmbedding: embedding,
        retrievalModel: embeddingModel,
        importance,
        observedStartAt,
        observedEndAt,
      })
      if (!updated) {
        return Response.json({ error: 'Memory not found' }, { status: 404 })
      }
      return Response.json({ ok: true, action, memory: serializeSqliteMemory(memoryId) })
    }

    if (action === 'entity.create' || action === 'entity.update') {
      const entityId = action === 'entity.update' ? readRequiredText(input.entityId) : null
      const type = readEntityType(input.type)
      const canonicalName = readRequiredText(input.canonicalName)
      const description = readOptionalText(input.description)
      const confidence = readProbability(input.confidence)
      const aliases = readAliases(input.aliases)
      if ((action === 'entity.update' && !entityId) || !type || !canonicalName || confidence === null || !aliases) {
        return validationError(`${action} requires type, canonicalName, confidence and aliases`)
      }

      const embeddingText = buildEntityEmbeddingText({ canonicalName, type, description, aliases })
      const embedding = await embedOne(embedder, embeddingText, embeddingModel)
      if (action === 'entity.create') {
        const entity = episodicMemoryGraphRepo.createEntity({
          agentId,
          type,
          canonicalName,
          description,
          confidence,
          aliases: aliases.map((alias) => ({ alias, confidence: 1 })),
        })
        episodicMemoryGraphRepo.updateEntityEmbedding({
          entityId: entity.id,
          embeddingText,
          embedding,
          embeddingModel,
        })
        return Response.json({ ok: true, action, entity: serializeEntity(getManagedEntity(agentId, entity.id)!) })
      }

      const updated = episodicMemoryGraphRepo.updateEntityByAgent({
        agentId,
        entityId: entityId!,
        type,
        canonicalName,
        description,
        confidence,
        aliases,
        embeddingText,
        embedding,
        embeddingModel,
      })
      if (!updated) {
        return Response.json({ error: 'Entity not found' }, { status: 404 })
      }
      return Response.json({ ok: true, action, entity: serializeEntity(getManagedEntity(agentId, entityId!)!) })
    }

    if (action === 'entity.delete') {
      const entityId = readRequiredText(input.entityId)
      if (!entityId) {
        return validationError('entity.delete requires entityId')
      }
      const deleted = episodicMemoryGraphRepo.deleteEntityByAgent(agentId, entityId)
      if (!deleted) {
        return Response.json({ error: 'Entity not found' }, { status: 404 })
      }
      return Response.json({ ok: true, action })
    }

    if (action === 'entity.merge') {
      const sourceEntityId = readRequiredText(input.sourceEntityId)
      const targetEntityId = readRequiredText(input.targetEntityId)
      if (!sourceEntityId || !targetEntityId || sourceEntityId === targetEntityId) {
        return validationError('entity.merge requires different sourceEntityId and targetEntityId')
      }
      const sourceEntity = getManagedEntity(agentId, sourceEntityId)
      const targetEntity = getManagedEntity(agentId, targetEntityId)
      if (!sourceEntity || !targetEntity) {
        return Response.json({ error: 'Entity not found' }, { status: 404 })
      }
      const mergedAliases = [...new Set([
        ...targetEntity.aliases,
        sourceEntity.canonicalName,
        ...sourceEntity.aliases,
      ].filter((alias) => alias !== targetEntity.canonicalName))]
      const embeddingText = buildEntityEmbeddingText({
        canonicalName: targetEntity.canonicalName,
        type: targetEntity.type,
        description: targetEntity.description,
        aliases: mergedAliases,
      })
      const embedding = await embedOne(embedder, embeddingText, embeddingModel)
      const merged = episodicMemoryGraphRepo.mergeEntitiesByAgent({
        agentId,
        sourceEntityId,
        targetEntityId,
      })
      if (!merged) {
        return Response.json({ error: 'Entity not found' }, { status: 404 })
      }
      episodicMemoryGraphRepo.updateEntityEmbedding({
        entityId: targetEntityId,
        embeddingText,
        embedding,
        embeddingModel,
      })
      return Response.json({ ok: true, action, entity: serializeEntity(getManagedEntity(agentId, targetEntityId)!) })
    }

    if (action === 'episodic.create' || action === 'episodic.update') {
      const memoryId = action === 'episodic.update' ? readRequiredText(input.memoryId) : null
      const summary = readRequiredText(input.summary)
      const detail = readOptionalText(input.detail)
      const importance = readProbability(input.importance)
      const observedStartAt = readDateOrNull(input.observedStartAt)
      const observedEndAt = readDateOrNull(input.observedEndAt)
      const entityLinks = readEntityLinks(input.entityLinks)
      if ((action === 'episodic.update' && !memoryId) || !summary || importance === null || observedStartAt === undefined || observedEndAt === undefined || !entityLinks) {
        return validationError(`${action} requires summary, importance, observedStartAt, observedEndAt and up to five entityLinks`)
      }
      if (!assertOwnedEntities(agentId, entityLinks)) {
        return validationError('entityLinks must reference existing entities owned by the agent')
      }

      const embedding = await embedOne(embedder, summary, embeddingModel)
      if (action === 'episodic.create') {
        const activeSession = sessionRepo.getLatestActiveSessionByAgent(agentId)
        if (!activeSession) {
          return Response.json({ error: 'No active session found' }, { status: 400 })
        }
        const memory = episodicMemoryGraphRepo.createEpisodicMemory({
          agentId,
          sessionId: activeSession.id,
          summary,
          sourceText: detail ?? summary,
          detail,
          retrievalEmbedding: embedding,
          retrievalModel: embeddingModel,
          importance,
          observedStartAt,
          observedEndAt,
          entityLinks,
        })
        return Response.json({
          ok: true,
          action,
          memory: serializeEpisodic(episodicMemoryGraphRepo.getEpisodicMemoryWithEntities(memory.id)!),
        })
      }

      const memory = episodicMemoryGraphRepo.updateEpisodicMemoryByAgent({
        agentId,
        memoryId: memoryId!,
        summary,
        sourceText: detail ?? summary,
        detail,
        retrievalEmbedding: embedding,
        retrievalModel: embeddingModel,
        importance,
        observedStartAt,
        observedEndAt,
        entityLinks,
      })
      if (!memory) {
        return Response.json({ error: 'Episodic memory not found' }, { status: 404 })
      }
      return Response.json({
        ok: true,
        action,
        memory: serializeEpisodic(episodicMemoryGraphRepo.getEpisodicMemoryWithEntities(memoryId!)!),
      })
    }

    if (action === 'episodic.delete') {
      const memoryId = readRequiredText(input.memoryId)
      if (!memoryId) {
        return validationError('episodic.delete requires memoryId')
      }
      const deleted = episodicMemoryGraphRepo.deleteEpisodicMemoryByAgent(agentId, memoryId)
      if (!deleted) {
        return Response.json({ error: 'Episodic memory not found' }, { status: 404 })
      }
      return Response.json({ ok: true, action })
    }

    if (action === 'edge.upsert') {
      const sourceEntityId = readRequiredText(input.sourceEntityId)
      const targetEntityId = readRequiredText(input.targetEntityId)
      const weight = readProbability(input.weight)
      const coOccurrenceCount = readNonNegativeInt(input.coOccurrenceCount)
      if (!sourceEntityId || !targetEntityId || sourceEntityId === targetEntityId || weight === null || coOccurrenceCount === null) {
        return validationError('edge.upsert requires different sourceEntityId and targetEntityId, weight and coOccurrenceCount')
      }
      const edge = episodicMemoryGraphRepo.setEntityEdgeByAgent({
        agentId,
        sourceEntityId,
        targetEntityId,
        weight,
        coOccurrenceCount,
      })
      if (!edge) {
        return Response.json({ error: 'Entity not found' }, { status: 404 })
      }
      return Response.json({ ok: true, action, edge })
    }

    if (action === 'edge.delete') {
      const sourceEntityId = readRequiredText(input.sourceEntityId)
      const targetEntityId = readRequiredText(input.targetEntityId)
      if (!sourceEntityId || !targetEntityId || sourceEntityId === targetEntityId) {
        return validationError('edge.delete requires different sourceEntityId and targetEntityId')
      }
      const deleted = episodicMemoryGraphRepo.deleteEntityEdgeByAgent({
        agentId,
        sourceEntityId,
        targetEntityId,
      })
      return Response.json({ ok: true, action, deleted })
    }
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Embedding failed' },
      { status: 502 },
    )
  }

  return validationError('Unknown memory edit action')
}
