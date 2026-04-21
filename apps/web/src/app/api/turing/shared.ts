import { agentRepo, daemonStateRepo, turingEventRepo, turingRunRepo } from '@mas/db'

function toIso(value: Date | null | undefined) {
  return value ? value.toISOString() : null
}

export function serializeTuringRun(run: ReturnType<typeof turingRunRepo.getRun> | null) {
  if (!run) {
    return null
  }

  const sourceAgent = agentRepo.getAgent(run.sourceAgentId)
  const tempAgent = run.tempAgentId ? agentRepo.getAgent(run.tempAgentId) : null

  return {
    id: run.id,
    sourceAgentId: run.sourceAgentId,
    sourceAgentName: sourceAgent?.name ?? null,
    tempAgentId: run.tempAgentId,
    tempAgentName: tempAgent?.name ?? null,
    tempSessionId: run.tempSessionId,
    status: run.status,
    currentStage: run.currentStage,
    abortReason: run.abortReason,
    judgeProvider: run.judgeProvider,
    judgeModel: run.judgeModel,
    report: run.report,
    transcript: run.transcript,
    error: run.error,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
    startedAt: toIso(run.startedAt),
    finishedAt: toIso(run.finishedAt),
    cleanedAt: toIso(run.cleanedAt),
  }
}

export function serializeTuringEvent(event: ReturnType<typeof turingEventRepo.getEvent> | null) {
  if (!event) {
    return null
  }

  return {
    id: event.id,
    runId: event.runId,
    kind: event.kind,
    message: event.message,
    payload: event.payload,
    createdAt: event.createdAt.toISOString(),
  }
}

export function serializeDaemonState() {
  const state = daemonStateRepo.getDaemonState()
  if (!state) {
    return null
  }

  return {
    id: state.id,
    pid: state.pid,
    status: state.status,
    startedAt: state.startedAt.toISOString(),
    lastHeartbeatAt: state.lastHeartbeatAt.toISOString(),
    stoppedAt: toIso(state.stoppedAt),
    lastError: state.lastError,
    updatedAt: state.updatedAt.toISOString(),
  }
}
