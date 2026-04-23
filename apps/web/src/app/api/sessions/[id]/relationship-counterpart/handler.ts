import {
  bindSessionRelationshipCounterpartForSession,
  serializeSessionRelationshipCounterpart,
  unbindSessionRelationshipCounterpartForSession,
} from '../../../agents/[id]/relationships/named-multi-dim/handler'

export function getSessionRelationshipCounterpartHandler(sessionId: string) {
  return serializeSessionRelationshipCounterpart(sessionId)
}

export function bindSessionRelationshipCounterpartHandler(sessionId: string, body: unknown) {
  return bindSessionRelationshipCounterpartForSession(sessionId, body)
}

export function unbindSessionRelationshipCounterpartHandler(sessionId: string) {
  return unbindSessionRelationshipCounterpartForSession(sessionId)
}
