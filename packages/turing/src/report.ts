import type { TuringJudgeEvaluation, TuringReport } from './types'

function clampScore(value: number) {
  return Math.max(0, Math.min(10, Number.isFinite(value) ? value : 0))
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
    naturalness: clampScore(average(evaluations.map((item) => item.scores.naturalness))),
    continuity: clampScore(average(evaluations.map((item) => item.scores.continuity))),
    recall: clampScore(average(evaluations.map((item) => item.scores.recall))),
    emotion: clampScore(average(evaluations.map((item) => item.scores.emotion))),
    relationship: clampScore(average(evaluations.map((item) => item.scores.relationship))),
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
