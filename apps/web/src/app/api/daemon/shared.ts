import {
  daemonEventRepo,
  daemonStateRepo,
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
