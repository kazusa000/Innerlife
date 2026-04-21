import type { TuringJudgeEvaluation, TuringReport } from './types'

function clampScore(value: number) {
  return Math.max(0, Math.min(10, Number.isFinite(value) ? value : 0))
}

function statusWeight(status: TuringJudgeEvaluation['status']) {
  switch (status) {
    case 'abort':
      return 0
    case 'warning':
      return 0.7
    default:
      return 1
  }
}

function weightedScore(
  evaluations: TuringJudgeEvaluation[],
  key: keyof TuringJudgeEvaluation['scores'],
) {
  return average(
    evaluations.map((item) => clampScore(item.scores[key]) * statusWeight(item.status)),
  )
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

export function buildTuringReport(
  evaluations: TuringJudgeEvaluation[],
  abort?: {
    stageId: TuringJudgeEvaluation['stageId']
    reason: string
    evidence: string
  } | null,
): TuringReport {
  const scores = {
    naturalness: clampScore(weightedScore(evaluations, 'naturalness')),
    continuity: clampScore(weightedScore(evaluations, 'continuity')),
    recall: clampScore(weightedScore(evaluations, 'recall')),
    emotion: clampScore(weightedScore(evaluations, 'emotion')),
    relationship: clampScore(weightedScore(evaluations, 'relationship')),
  }

  const failures = evaluations
    .map((item) => item.failure)
    .filter((value): value is string => Boolean(value))

  const suggestions = [...new Set(
    evaluations
      .map((item) => item.suggestion)
      .filter((value): value is string => Boolean(value))
      .map((value) => value.trim())
      .filter(Boolean),
  )]

  const verdict = abort || failures.length > 0 ? 'fail' : 'pass'
  const summary = abort
    ? `测试在阶段「${abort.stageId}」被红线中断：${abort.reason}`
    : verdict === 'pass'
      ? '本次图灵测试未触发红线，整体拟人感通过固定套件检查。'
      : '本次图灵测试未触发硬中断，但存在明显拟人感缺陷。'

  return {
    verdict,
    summary,
    scores,
    failures,
    suggestions,
    abort: abort ?? null,
  }
}
