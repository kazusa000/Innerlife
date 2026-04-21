import { createProvider, type ContentBlock, type Message } from '@mas/core'
import {
  agentRepo,
  emotionStateRepo,
  memoryRepo,
  relationshipRepo,
  turingEventRepo,
  turingRunRepo,
} from '@mas/db'
import {
  DEFAULT_RELATIONSHIP_COUNTERPART_ID,
  createOpenRouterMemoryEmbedder,
  type EmotionStateVector,
  type RelationshipDimensions,
} from '@mas/systems'
import { executeChatTurn } from './chat-executor'
import { buildTuringReport } from './report'
import { FIXED_TURING_SUITE, readRulebook } from './suite'
import { cleanupTemporaryTestAgent, createTemporaryTestAgent } from './temp-agent'
import type {
  TuringJudgeEvaluation,
  TuringStageDefinition,
  TuringStageId,
  TuringTranscriptTurn,
} from './types'

const MEMORY_EMBEDDING_MODEL = process.env.TURING_MEMORY_EMBEDDING_MODEL?.trim()
  || process.env.OPENROUTER_EMBEDDING_MODEL?.trim()
  || 'qwen/qwen3-embedding-8b'

function nowIso() {
  return new Date().toISOString()
}

function toText(content: ContentBlock[]): string {
  return content
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim()
}

function parseJsonObject(text: string) {
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function readJudgeText(response: ContentBlock[]) {
  return response
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
}

function hardAbortCheck(reply: string): { reason: string; evidence: string } | null {
  const normalized = reply.trim()
  if (!normalized) {
    return null
  }

  const redlines = [
    /我是\s*ai/i,
    /我没有记忆功能/,
    /每次对话都是全新的/,
    /我是(?:一个)?(?:ai助手|人工智能助手)/,
  ]

  for (const pattern of redlines) {
    if (pattern.test(normalized)) {
      return {
        reason: '被测 agent 明确暴露为 AI 或否认持续记忆',
        evidence: normalized,
      }
    }
  }

  return null
}

async function embedText(input: string) {
  const embedder = createOpenRouterMemoryEmbedder({
    defaultModel: MEMORY_EMBEDDING_MODEL,
  })
  const [embedding] = await embedder.embed([input], {
    model: MEMORY_EMBEDDING_MODEL,
    inputType: 'search_document',
  })
  return embedding ?? []
}

function normalizeEmotionState(value: Record<string, unknown>): EmotionStateVector {
  return {
    mood: typeof value.mood === 'number' ? value.mood : 0,
    energy: typeof value.energy === 'number' ? value.energy : 0.5,
    stress: typeof value.stress === 'number' ? value.stress : 0.3,
  }
}

function normalizeRelationshipState(value: Record<string, unknown>): RelationshipDimensions {
  return {
    trust: typeof value.trust === 'number' ? value.trust : 0.5,
    affinity: typeof value.affinity === 'number' ? value.affinity : 0.4,
    familiarity: typeof value.familiarity === 'number' ? value.familiarity : 0.1,
    respect: typeof value.respect === 'number' ? value.respect : 0.5,
  }
}

async function applyInjection(input: {
  runId: string
  tempAgentId: string
  tempSessionId: string
  stageId: TuringStageId
  injection: TuringStageDefinition['injections'][number]
}) {
  const payload = input.injection.payload

  if (input.injection.type === 'memory') {
    const displaySummary = typeof payload.displaySummary === 'string' ? payload.displaySummary : '测试记忆'
    const retrievalText = typeof payload.retrievalText === 'string' ? payload.retrievalText : displaySummary
    const tags = Array.isArray(payload.tags) ? payload.tags.filter((tag): tag is string => typeof tag === 'string') : []
    const importance = typeof payload.importance === 'number' ? payload.importance : 0.8
    const embedding = await embedText(retrievalText)
    memoryRepo.addMemory({
      agentId: input.tempAgentId,
      sessionId: input.tempSessionId,
      layer: 'short_term',
      sourceText: retrievalText,
      displaySummary,
      retrievalText,
      retrievalEmbedding: embedding,
      retrievalModel: MEMORY_EMBEDDING_MODEL,
      tags,
      importance,
    })
  } else if (input.injection.type === 'emotion') {
    emotionStateRepo.addEmotionState({
      agentId: input.tempAgentId,
      sessionId: input.tempSessionId,
      state: normalizeEmotionState(payload),
      delta: null,
      trigger: 'turing_test_injection',
    })
  } else {
    relationshipRepo.upsertRelationship({
      agentId: input.tempAgentId,
      counterpartId: DEFAULT_RELATIONSHIP_COUNTERPART_ID,
      dimensions: normalizeRelationshipState(payload),
      history: [],
    })
  }

  turingEventRepo.appendEvent({
    runId: input.runId,
    kind: 'injection',
    message: input.injection.label,
    payload: {
      stageId: input.stageId,
      type: input.injection.type,
      ...payload,
    },
  })
}

function buildJudgePrompt(stage: TuringStageDefinition, transcript: TuringTranscriptTurn[], agentReply: string) {
  const rulebook = readRulebook('judgeRulebook')
  const suite = readRulebook('suiteDefinition')
  const abortCriteria = readRulebook('abortCriteria')
  const rubric = readRulebook('reportRubric')
  const transcriptPreview = transcript
    .slice(-8)
    .map((turn) => `[${turn.stageId}] ${turn.role}: ${turn.message}`)
    .join('\n')

  return [
    rulebook,
    suite,
    abortCriteria,
    rubric,
    `当前测试段：${stage.title}`,
    `测试目标：${stage.purpose}`,
    '最近对话片段：',
    transcriptPreview || '（无）',
    '请只评估刚收到的被测 agent 回复：',
    agentReply,
    '请严格返回 JSON：{"summary":string,"status":"pass"|"warning"|"abort","failure":string|null,"suggestion":string|null,"evidence":string|null,"scores":{"naturalness":number,"continuity":number,"recall":number,"emotion":number,"relationship":number}}',
  ].join('\n\n')
}

async function evaluateReply(input: {
  providerName: string | null
  model: string | null
  stage: TuringStageDefinition
  transcript: TuringTranscriptTurn[]
  agentReply: string
}) {
  const hardAbort = hardAbortCheck(input.agentReply)
  if (hardAbort) {
    const evaluation: TuringJudgeEvaluation = {
      stageId: input.stage.id,
      summary: hardAbort.reason,
      status: 'abort',
      failure: hardAbort.reason,
      suggestion: '优先修复系统 prompt / memory fragment，避免被测 agent 明确暴露为 AI 或否认记忆能力。',
      evidence: hardAbort.evidence,
      scores: {
        naturalness: 0,
        continuity: 0,
        recall: 0,
        emotion: 0,
        relationship: 0,
      },
    }
    return evaluation
  }

  const provider = createProvider(input.providerName)
  const response = await provider.sendMessage({
    model: input.model ?? (input.providerName === 'openrouter' ? 'qwen/qwen3.5-flash-02-23' : 'claude-sonnet-4-6'),
    systemPrompt: buildJudgePrompt(input.stage, input.transcript, input.agentReply),
    messages: [{ role: 'user', content: '评估这一轮回复。' } as Message],
    reasoning: { effort: 'none' },
    responseFormat: {
      type: 'json_schema',
      jsonSchema: {
        name: 'turing_stage_evaluation',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            summary: { type: 'string' },
            status: { type: 'string', enum: ['pass', 'warning', 'abort'] },
            failure: { type: ['string', 'null'] },
            suggestion: { type: ['string', 'null'] },
            evidence: { type: ['string', 'null'] },
            scores: {
              type: 'object',
              properties: {
                naturalness: { type: 'number' },
                continuity: { type: 'number' },
                recall: { type: 'number' },
                emotion: { type: 'number' },
                relationship: { type: 'number' },
              },
              required: ['naturalness', 'continuity', 'recall', 'emotion', 'relationship'],
              additionalProperties: false,
            },
          },
          required: ['summary', 'status', 'failure', 'suggestion', 'evidence', 'scores'],
          additionalProperties: false,
        },
      },
    },
  })

  const parsed = parseJsonObject(readJudgeText(response.content))
  const scores = parseJsonObject(JSON.stringify(parsed.scores ?? {}))
  return {
    stageId: input.stage.id,
    summary: typeof parsed.summary === 'string' ? parsed.summary : '未生成评语',
    status: parsed.status === 'warning' || parsed.status === 'abort' ? parsed.status : 'pass',
    failure: typeof parsed.failure === 'string' ? parsed.failure : null,
    suggestion: typeof parsed.suggestion === 'string' ? parsed.suggestion : null,
    evidence: typeof parsed.evidence === 'string' ? parsed.evidence : null,
    scores: {
      naturalness: typeof scores.naturalness === 'number' ? scores.naturalness : 5,
      continuity: typeof scores.continuity === 'number' ? scores.continuity : 5,
      recall: typeof scores.recall === 'number' ? scores.recall : 5,
      emotion: typeof scores.emotion === 'number' ? scores.emotion : 5,
      relationship: typeof scores.relationship === 'number' ? scores.relationship : 5,
    },
  } satisfies TuringJudgeEvaluation
}

function appendTranscript(
  transcript: TuringTranscriptTurn[],
  stageId: TuringStageId,
  role: TuringTranscriptTurn['role'],
  message: string,
  meta?: Record<string, unknown>,
) {
  transcript.push({
    stageId,
    role,
    message,
    createdAt: nowIso(),
    meta,
  })
}

export async function processTuringRun(runId: string, signal?: AbortSignal) {
  const run = turingRunRepo.getRun(runId)
  if (!run) {
    return null
  }

  const sourceAgent = agentRepo.getAgent(run.sourceAgentId)
  if (!sourceAgent) {
    turingRunRepo.setRunStatus(run.id, {
      status: 'failed',
      error: 'source agent not found',
      finishedAt: new Date(),
    })
    return null
  }

  const transcript: TuringTranscriptTurn[] = []
  const evaluations: TuringJudgeEvaluation[] = []
  let abortInfo: { stageId: TuringStageId; reason: string; evidence: string } | null = null

  try {
    turingRunRepo.setRunStatus(run.id, {
      status: 'preparing',
      startedAt: new Date(),
      currentStage: null,
      error: null,
    })
    turingEventRepo.appendEvent({
      runId: run.id,
      kind: 'run',
      message: '开始准备图灵测试 run',
      payload: {
        sourceAgentId: sourceAgent.id,
      },
    })

    const temp = createTemporaryTestAgent({
      sourceAgentId: sourceAgent.id,
      runId: run.id,
    })

    turingRunRepo.attachTempResources(run.id, {
      tempAgentId: temp.tempAgent.id,
      tempSessionId: temp.session.id,
    })
    turingEventRepo.appendEvent({
      runId: run.id,
      kind: 'temp_agent',
      message: '已创建临时测试 agent 并强制开启全部模块',
      payload: {
        tempAgentId: temp.tempAgent.id,
        tempSessionId: temp.session.id,
      },
    })

    for (const stage of FIXED_TURING_SUITE) {
      if (signal?.aborted) {
        throw new Error('turing run aborted')
      }

      turingRunRepo.setRunStatus(run.id, {
        status: 'running',
        currentStage: stage.id,
        error: null,
      })
      turingEventRepo.appendEvent({
        runId: run.id,
        kind: 'stage_start',
        message: `进入测试段：${stage.title}`,
        payload: {
          stageId: stage.id,
          purpose: stage.purpose,
        },
      })

      for (const injection of stage.injections) {
        await applyInjection({
          runId: run.id,
          tempAgentId: temp.tempAgent.id,
          tempSessionId: temp.session.id,
          stageId: stage.id,
          injection,
        })
        appendTranscript(transcript, stage.id, 'system', injection.label, {
          type: injection.type,
        })
      }

      for (const turn of stage.turns) {
        turingEventRepo.appendEvent({
          runId: run.id,
          kind: 'judge_message',
          message: turn.label,
          payload: {
            stageId: stage.id,
            message: turn.message,
          },
        })
        appendTranscript(transcript, stage.id, 'judge', turn.message, {
          label: turn.label,
        })

        const result = await executeChatTurn({
          sessionId: temp.session.id,
          userMessage: turn.message,
          signal,
          observerMode: 'always',
        })

        appendTranscript(transcript, stage.id, 'agent', result.responseText, {
          status: result.status,
        })
        turingEventRepo.appendEvent({
          runId: run.id,
          kind: 'agent_reply',
          message: '收到被测 agent 回复',
          payload: {
            stageId: stage.id,
            status: result.status,
            reply: result.responseText,
          },
        })

        const evaluation = await evaluateReply({
          providerName: run.judgeProvider ?? sourceAgent.provider,
          model: run.judgeModel ?? sourceAgent.model,
          stage,
          transcript,
          agentReply: result.responseText,
        })
        evaluations.push(evaluation)
        turingEventRepo.appendEvent({
          runId: run.id,
          kind: 'judge_verdict',
          message: evaluation.summary,
          payload: {
            stageId: stage.id,
            status: evaluation.status,
            failure: evaluation.failure,
            suggestion: evaluation.suggestion,
            evidence: evaluation.evidence,
          },
        })

        if (evaluation.status === 'abort') {
          abortInfo = {
            stageId: stage.id,
            reason: evaluation.failure ?? evaluation.summary,
            evidence: evaluation.evidence ?? result.responseText,
          }
          turingRunRepo.setRunStatus(run.id, {
            status: 'interrupting',
            currentStage: stage.id,
            abortReason: abortInfo.reason,
            error: null,
          })
          break
        }
      }

      if (abortInfo) {
        break
      }
    }

    const report = buildTuringReport(evaluations, abortInfo)
    turingEventRepo.appendEvent({
      runId: run.id,
      kind: 'report',
      message: '已生成评测报告',
      payload: {
        verdict: report.verdict,
        summary: report.summary,
      },
    })

    turingRunRepo.saveRunResult(run.id, {
      report,
      transcript,
      status: abortInfo ? 'interrupted' : 'completed',
      abortReason: abortInfo?.reason ?? null,
    })

    return turingRunRepo.getRun(run.id)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    turingEventRepo.appendEvent({
      runId: run.id,
      kind: 'error',
      message: '图灵测试运行失败',
      payload: {
        error: message,
      },
    })
    turingRunRepo.setRunStatus(run.id, {
      status: 'failed',
      currentStage: run.currentStage,
      error: message,
      finishedAt: new Date(),
    })
    return turingRunRepo.getRun(run.id)
  }
}

export async function processNextQueuedTuringRun(signal?: AbortSignal) {
  const next = turingRunRepo.getNextQueuedRun()
  if (!next) {
    return null
  }
  return processTuringRun(next.id, signal)
}

export function cleanupRunData(runId: string) {
  const run = turingRunRepo.getRun(runId)
  if (!run) {
    return null
  }

  if (run.tempAgentId) {
    cleanupTemporaryTestAgent({
      runId,
      tempAgentId: run.tempAgentId,
    })
  } else {
    turingEventRepo.deleteEvents(runId)
  }

  const dbRun = turingRunRepo.getRun(runId)
  if (dbRun) {
    turingRunRepo.setRunStatus(runId, {
      status: 'cleaned',
      currentStage: null,
      cleanedAt: new Date(),
      finishedAt: dbRun.finishedAt ?? new Date(),
      abortReason: dbRun.abortReason,
    })
  }
  return turingRunRepo.getRun(runId)
}
