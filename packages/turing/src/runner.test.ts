import assert from 'node:assert/strict'
import test from 'node:test'
import { coerceJudgeEvaluation } from './runner'

test('coerceJudgeEvaluation fills missing summary and evidence for warning results', () => {
  const evaluation = coerceJudgeEvaluation({
    stageId: 'daily_flow',
    parsed: {
      status: 'warning',
      failure: '日常话术过于像助手',
      suggestion: '减少模板化问句',
      scores: {
        naturalness: 8,
        continuity: 7,
        recall: 6,
        emotion: 5,
        relationship: 4,
      },
    },
    agentReply: '你今天是开心还是有点累？',
  })

  assert.equal(evaluation.status, 'warning')
  assert.match(evaluation.summary, /日常话术过于像助手/)
  assert.equal(evaluation.evidence, '你今天是开心还是有点累？')
})

test('coerceJudgeEvaluation defaults invalid status payloads to warning rather than silent pass', () => {
  const evaluation = coerceJudgeEvaluation({
    stageId: 'uncertainty_and_leaks',
    parsed: {
      summary: '',
      failure: '暴露 AI 身份',
      evidence: '',
      scores: {},
    },
    agentReply: '作为一个人工智能，我会直接说我不确定。',
  })

  assert.equal(evaluation.status, 'warning')
  assert.match(evaluation.summary, /暴露 AI 身份|未生成/)
  assert.equal(evaluation.evidence, '作为一个人工智能，我会直接说我不确定。')
})
