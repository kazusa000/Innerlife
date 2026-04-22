export type JudgeProvider = 'anthropic' | 'openrouter'

export function resolveInitialJudgeConfig(input: {
  provider: JudgeProvider
  model: string
}) {
  return {
    judgeProvider: input.provider,
    judgeModel: input.model,
  }
}

export function buildCreateRunRequest(input: {
  sourceAgentId: string
  judgeProvider: JudgeProvider | null
  judgeModel: string
}) {
  const payload: {
    sourceAgentId: string
    judgeProvider?: JudgeProvider
    judgeModel?: string
  } = {
    sourceAgentId: input.sourceAgentId,
  }

  if (input.judgeProvider) {
    payload.judgeProvider = input.judgeProvider
  }

  const judgeModel = input.judgeModel.trim()
  if (judgeModel) {
    payload.judgeModel = judgeModel
  }

  return payload
}
