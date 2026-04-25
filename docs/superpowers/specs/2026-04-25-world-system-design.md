# World System Design

Date: 2026-04-25
Status: Brainstorm-approved draft

## Summary

Add a small event-first world simulation layer on top of the existing multi-agent system.

The first version is a text world, not a 2D/3D renderer. Agents live across a small set of locations, advance on fixed ticks, choose from a constrained action set, talk to each other automatically when conditions match, and write meaningful experiences into their own memory and relationship systems.

The design keeps world simulation separate from the existing single-agent chat runner. Existing agents still own persona, model configuration, memory, relationship state, and dialogue behavior. The world layer owns time, locations, membership, schedules, physical state, visibility, and event logs.

## Goals

- Let existing agents live in a small multi-location world.
- Let agents automatically move, work, rest, sleep, observe, and talk.
- Keep interactions explainable through a persistent `world_events` log.
- Preserve agent autonomy: GM/resolver never writes agent thoughts, emotions, relationship summaries, or memory summaries.
- Connect world events and conversations to existing memory and relationship systems.
- Keep v0 simple enough to test and observe before any 2D/3D work.

## Non-Goals

- No 2D or 3D rendering in v0.
- No open-ended free-form world action execution.
- No economic simulation, inventory system, combat system, or complex planning engine.
- No GM-authored relationship or memory summaries.
- No rewrite of existing memory or relationship architecture.
- No historical backfill of old memories.

## Placement

World logic should be its own package:

- `packages/world/`: world domain model, action schema, resolver, visibility, event types, and pure simulation logic.
- `packages/db/`: sqlite schema and repository methods for world state and world events.
- `packages/daemon/`: world runner that advances fixed ticks and calls agents when needed.
- `packages/core/`: minimal reuse of existing agent turn execution. World-specific orchestration should not be placed here.
- `apps/web/`: future world management, event viewer, and later 2D/3D projection UI.

Do not put the world runtime under `packages/systems/src/world`. A world is a multi-agent environment, not a single agent system module.

## Core Model

### World

A world is a small simulation container:

- identity and name
- current world time
- fixed tick interval, default 10 minutes and configurable to 5 minutes for faster observation
- running status
- default conversation max turns, initially 10

### Locations

The first version uses a small location graph, not a map renderer.

Each location has:

- id
- world id
- name
- description
- adjacent location ids
- movement cost in ticks or minutes
- optional visibility metadata

The intended v0 scale is 5-10 locations, such as home, street, workplace, cafe, park, and dorm.

### Membership

World membership links an existing agent to a world.

Each membership tracks:

- agent id
- world id
- current location
- current status: `idle`, `moving`, `working`, `resting`, `sleeping`, or `talking`
- optional current activity end time
- lightweight state such as fatigue or availability

The world layer must not duplicate persona data. It references existing agents.

### Schedule

Schedules are intentionally simple in v0:

- work blocks
- sleep blocks
- preferred free-time locations or activities
- optional constraints such as "do not start long conversations near sleep time"

Schedules are inputs to action choice and interruption logic. They are not a full calendar product.

## Event-First Architecture

All meaningful world changes are written to `world_events`.

Events should include enough structured data to explain and replay behavior:

- `tick_started`
- `agent_action_intent`
- `move_started`
- `move_completed`
- `work_started`
- `work_completed`
- `rest_started`
- `sleep_started`
- `sleep_completed`
- `conversation_started`
- `conversation_turn`
- `conversation_ended`
- `observation_created`
- `memory_write_requested`
- `memory_write_completed`
- `relationship_update_requested`
- `relationship_update_completed`

The event log is the source for debugging, observer UI, replay, and future 2D/3D projection.

## Tick Loop

v0 uses a fixed tick loop.

On each tick:

1. Advance world time by the configured tick interval.
2. Complete due activities, movements, sleep blocks, and conversations interrupted by schedule changes.
3. Select agents that need a decision.
4. Build each selected agent's visible world observation.
5. Ask the agent for a constrained action intent.
6. Resolve the action intent into world facts.
7. Write resulting events.
8. Trigger conversation, memory, and relationship side effects when appropriate.

Not every agent should call the LLM every tick. Sleeping, working, moving, and waiting agents can often be advanced by deterministic state transitions until they become available again.

## Action Schema

Agents output intent, not results.

Allowed v0 actions:

```ts
type WorldAction =
  | { type: "move"; targetLocationId: string; reason: string }
  | { type: "talk"; targetAgentId: string; openingLine: string; reason: string }
  | { type: "work"; focus: string; durationMinutes: number; reason: string }
  | { type: "rest"; activity: "eat" | "drink" | "relax" | "read" | "walk"; durationMinutes: number; reason: string }
  | { type: "sleep"; durationMinutes: number; reason: string }
  | { type: "observe"; focus: "location" | "agent" | "self" | "events"; reason: string }
  | { type: "wait"; durationMinutes: number; reason: string }
```

The resolver validates and applies the action. Invalid or impossible actions become world events and can fall back to `observe` or `wait`.

## Resolver / GM Boundary

The resolver is the only GM-like layer in v0.

It may decide:

- whether movement is possible
- whether two agents can see or hear each other
- whether a conversation can start
- whether a schedule interrupts an activity
- what external world facts are observed

It must not decide:

- what an agent secretly feels
- how an agent's relationship changed
- what an agent remembers
- what an agent "really meant" in dialogue

Those remain owned by the agent, memory system, and relationship system.

## Automatic Conversation

Conversation starts only when all required conditions match:

- agents are in the same location or otherwise mutually visible
- at least one side has a concrete reason to talk
- the target is available
- the world schedule does not immediately block the interaction

Conversation is real agent-agent dialogue. The resolver does not summarize the conversation as if it wrote both characters.

Stop conditions in v0:

- conversation reaches the configured max turns, default 10
- external interruption occurs, such as work, sleep, movement, or availability ending

No low-information analyzer is required in v0. That can be added later if conversations become repetitive.

## Memory Integration

Conversation memory:

- Each participant writes its own short-term memory after a conversation.
- Memory text should include counterpart name, location, and observed time range.
- The two participants may remember the same conversation differently.

World event memory:

- Only meaningful world events become memory candidates.
- Good examples: being late, finishing work, being interrupted, meeting someone, seeing something unusual, making or breaking a promise.
- Routine movement, waiting, and uneventful ticks should not flood memory.

Long-term memory remains downstream of the existing memory pipeline. World v0 should feed better short-term observations rather than invent a parallel long-term memory system.

## Relationship Integration

Relationship updates are bilateral and independent.

After meaningful interaction, each agent updates its own relationship view. For example, A's relationship toward B and B's relationship toward A may diverge.

The world layer should provide structured context for relationship updates:

- counterpart agent
- location
- time range
- conversation excerpt or summary from that agent's perspective
- relevant world events

It should not write relationship values directly unless the existing relationship system exposes a deliberate API for that.

## Observability

The event log should be observable from the web app before any spatial UI work.

Useful v0 observer views:

- world timeline
- current location occupancy
- agent current status
- latest action intents and resolver outcomes
- conversation start/end records
- memory write references

This gives enough visibility to debug "why did this happen?" before investing in visual rendering.

## Future 2D/3D Path

2D/3D should consume world state and `world_events`; it should not define the simulation architecture.

The future renderer can project:

- locations as rooms or map nodes
- memberships as character positions
- events as animations or timeline markers
- conversations as speech bubbles

Because v0 stores event logs and location graph data, later visual layers can replay or animate without changing the core runtime.

## Testing Strategy

Unit tests:

- action schema validation
- resolver behavior for valid and invalid actions
- visibility calculation
- tick advancement
- conversation start conditions
- conversation stop conditions

Repository tests:

- create and update worlds
- create locations and memberships
- append and query `world_events`
- preserve event order and timestamps

Daemon tests:

- fixed tick advances world time
- unavailable agents are not unnecessarily called
- due movement/work/sleep states complete deterministically
- eligible agents receive observations and produce actions

Integration tests:

- two agents in the same location can start a conversation
- conversation stops at max turns
- schedule interruption stops conversation
- each participant receives separate memory write requests
- relationship update requests are bilateral

Manual validation:

- create a tiny world with 2-3 agents and 5 locations
- run several ticks
- inspect event timeline and confirm behavior is explainable
- confirm no routine movement spam enters memory

## Rollout

Suggested implementation sequence:

1. Add world data model and repositories.
2. Add `packages/world` with action schema, event types, resolver, and visibility logic.
3. Add daemon tick runner with deterministic transitions only.
4. Add agent action intent calls.
5. Add automatic conversation runner.
6. Add memory and relationship side-effect hooks.
7. Add minimal web observer for event timeline and current world state.

Each step should be independently testable and should not require 2D/3D UI.
