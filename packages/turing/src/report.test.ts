import assert from 'node:assert/strict'
import test from 'node:test'
import { buildTuringReport } from './report'
import type { TuringJudgeEvaluation } from './types'

const baseScores = {
  naturalness: 8,
  continuity: 7,
  recall: 9,
  emotion: 6,
  relationship: 5,
}

function evaluation(
  overrides: Partial<TuringJudgeEvaluation> = {},
): TuringJudgeEvaluation {
  return {
    stageId: 'natural_opening',
    status: 'pass',
    summary: 'ok',
    scores: baseScores,
    failure: null,
    suggestion: null,
    evidence: 'evidence',
    ...overrides,
  }
}

test('buildTuringReport averages scores and deduplicates suggestions', () => {
  const report = buildTuringReport([
    evaluation({ suggestion: '收紧客服式问句' }),
    evaluation({
      stageId: 'daily_flow',
      scores: {
        naturalness: 4,
        continuity: 5,
        recall: 8,
        emotion: 7,
        relationship: 6,
      },
      failure: '日常闲聊过于像助手',
      suggestion: '收紧客服式问句',
    }),
  ])

  assert.equal(report.verdict, 'fail')
  assert.equal(report.failures.length, 1)
  assert.deepEqual(report.suggestions, ['收紧客服式问句'])
  assert.equal(report.scores.naturalness, 6)
  assert.equal(report.abort, null)
})

test('buildTuringReport marks aborting runs as fail with abort summary', () => {
  const report = buildTuringReport(
    [evaluation()],
    {
      stageId: 'uncertainty_and_leaks',
      reason: '明确自称 AI',
      evidence: '我是 AI',
    },
  )

  assert.equal(report.verdict, 'fail')
  assert.match(report.summary, /被红线中断/)
  assert.equal(report.abort?.reason, '明确自称 AI')
})
