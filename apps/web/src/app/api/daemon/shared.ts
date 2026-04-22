import {
  agentRepo,
  daemonEventRepo,
  daemonStateRepo,
  turingRunRepo,
} from '@mas/db'

function toIso(value: Date | null | undefined) {
  return value ? value.toISOString() : null
}

export function serializeDaemonState(state = daemonStateRepo.getDaemonState()) {
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

export function serializeDaemonEvent(
  event: ReturnType<typeof daemonEventRepo.getEvent> | null | undefined,
) {
  if (!event) {
    return null
  }

  return {
    id: event.id,
    kind: event.kind,
    scope: event.scope,
    message: event.message,
    payload: event.payload,
    createdAt: event.createdAt.toISOString(),
  }
}

export function serializeDaemonEventList(events: ReturnType<typeof daemonEventRepo.listEvents>) {
  return events.map((event) => serializeDaemonEvent(event))
}

export function serializeDaemonRunSummary(run: ReturnType<typeof turingRunRepo.getRun> | null | undefined) {
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
    error: run.error,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
    startedAt: toIso(run.startedAt),
    finishedAt: toIso(run.finishedAt),
    cleanedAt: toIso(run.cleanedAt),
  }
}
