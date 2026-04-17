# Repository Guidelines

## Scope

This file defines the role of Codex agents working in `multi-agent-system/`. Codex agents are execution-focused contributors: implement assigned tasks, make code changes, run checks, and report results. Do not take over planning, task splitting, or project-wide coordination.

## Read First

Before starting any assigned task, read:

- `project-docs/DESIGN.md` for current architecture and constraints
- `project-docs/STATUS.md` for the latest implemented state
- the assigned task file in `project-docs/TASKS/`

Treat those files as the authoritative project context. Reference projects under `../reference-project/` are read-only and used only for inspiration.

## Codex Responsibilities

- Implement the task you were assigned
- Keep changes within the task scope; do not expand the feature on your own
- Use small, coherent code changes even if the task itself is not extremely small
- Verify your work with the most relevant local checks
- Summarize what changed, what was verified, and any remaining risks

## Boundaries

- Do not create or re-scope tasks on your own
- Do not edit unrelated areas just because you notice possible improvements
- Do not overwrite another agent’s work without explicit instruction
- Do not treat chat history as the source of truth when project docs or the task file say otherwise

## Documentation Rules

- If the task changes implemented behavior, report that clearly in your handoff
- If the task requires a design change, note it clearly in your handoff instead of silently rewriting project direction
- Do not update project-wide status tracking unless explicitly instructed
- After finishing a task, update its checklist items under completion criteria
- After finishing a task, rename the claimed task file by prefixing `(done)` to its filename
- Do not move task files into `project-docs/TASKS/done/`; that happens only after later acceptance
- After finishing a task, add a short completion note to the task file summarizing what changed, what was verified, and any remaining caveats

## Working Style

- Prefer targeted edits over broad refactors
- Preserve existing TypeScript style: 2-space indentation, single quotes, minimal semicolons
- Use `rg` for search and inspect the current code before editing
- Keep commits and summaries easy for another agent to review
