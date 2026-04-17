# Worker Agent Guidelines

## Scope

This file defines the role of **execution agents** working inside `multi-agent-system/`. Execution agents are implementers: claim a task, make the change, verify it, and hand back. Coordination (task splitting, design drift, cross-task arbitration, merges) belongs to the Coordinator — see `project-docs/` for what they maintain.

## Read First

Before starting **any** assigned task, read, in order:

1. `project-docs/DESIGN.md` — current architecture and constraints
2. `project-docs/STATUS.md` — what's already implemented; do not re-do it
3. The task file in `project-docs/TASKS/` (the one you were assigned)

Those three are authoritative project context. Reference projects under `../reference-project/` are read-only — pull ideas, don't copy wholesale.

## Three-State Task Prefix

Tasks live in `project-docs/TASKS/`. A single task file moves through three states as a **file-rename**, nothing else:

| State | Filename | Meaning |
|---|---|---|
| unclaimed | `<ID>.md` (no prefix) | Available |
| claimed, in progress | `(doing)<ID>.md` | An agent has picked it up |
| self-reported complete | `(done)<ID>.md` | Awaiting Coordinator review |
| accepted & archived | `done/<ID>.md` | Coordinator moved it after merge |

Rules:

- **Claim**: rename the task file to `(doing)<ID>.md` before touching code. This signals ownership. If the file is already prefixed, don't take it.
- **Finish**: when you're done and self-tested, rename to `(done)<ID>.md` and add a short **Completion Note** to the task body (see below). Leave it in `project-docs/TASKS/` — do **not** move to `done/`; that's the Coordinator's final step after they verify and merge.
- **Don't skip states**: no writing code before renaming to `(doing)`; no moving to `done/` yourself.

## Git Worktree Workflow

Each task must land on its **own** branch in its **own** worktree. This lets multiple agents work simultaneously without stomping on each other's checkout.

From the repo root (`multi-agent-system/multi-agent-system/`):

```bash
# Create a branch + worktree for your task
git worktree add ../wt/<ID> -b task/<ID>

# Move into it
cd ../wt/<ID>

# Do your work; commit to task/<ID> as you go
git add <files>
git commit -m "<conventional commit message>"
```

Branch naming: `task/<ID>` (lowercase, matches the task ID, e.g. `task/a4-tool-autoregistry`).
Worktree path: `../wt/<ID>/` (sibling to the main repo checkout).

When you're done:

1. Ensure your branch has clean commits (squash trivial fixups if useful, but don't force-push shared history).
2. Do **not** merge into `master` yourself — the Coordinator reviews on your branch and merges.
3. Leave the worktree in place until the Coordinator closes it out.

If the task is tiny (one-file, zero-risk, e.g. typo fix), you may skip the worktree and work on `master` directly — but default to a worktree.

## Commit Hygiene

- Prefer a small number of **coherent** commits over one giant commit. Each commit should be independently understandable.
- Conventional-style prefixes are encouraged: `feat(core): ...`, `fix(web): ...`, `docs: ...`, `test: ...`.
- Don't skip hooks (`--no-verify`, `--no-gpg-sign`) unless explicitly told.
- Never force-push.

## Responsibilities

- Implement the task you claimed; keep changes within its stated scope.
- When the DESIGN contract is ambiguous, make a judgment call and **document it in the Completion Note** so the Coordinator can decide whether to amend DESIGN.
- Verify with the most relevant local checks — at minimum:
  - `npm run typecheck` (or workspace equivalent) on touched packages
  - `npm test` if tests exist for touched areas
  - a build (`npm run build`) if you changed anything in `apps/web`
- Summarize what changed, what was verified, and what you couldn't verify.

## Boundaries

- Don't re-scope or create new tasks on your own — ask the Coordinator instead.
- Don't edit unrelated areas because you noticed something. File it as a note in the Completion section; the Coordinator decides follow-up.
- Don't overwrite another agent's work without explicit instruction.
- Don't treat chat history as the source of truth when project docs or the task file disagree.

## Documentation Rules

- After finishing, check off items in the task's completion-standard list.
- Rename the task file to `(done)<ID>.md`. Do **not** move it into `project-docs/TASKS/done/`.
- Add a short **Completion Note** section to the task file (see template below).
- Do not update `project-docs/STATUS.md` yourself — the Coordinator updates it after archiving.
- If the task forced a design change, write it in the Completion Note rather than silently editing `DESIGN.md`. The Coordinator reconciles the design.

## Completion Note Template

Append this to the bottom of the task file before renaming to `(done)`:

```markdown
## Completion Note

- **Changes**: one or two lines on what landed
- **Verified**: typecheck / tests / build results
- **Caveats**: anything you couldn't verify, assumptions you made, or
  places a future agent should double-check
- **Design deltas** (if any): what diverged from DESIGN.md and why
```

## Working Style

- Prefer targeted edits over broad refactors.
- Preserve existing TypeScript style: 2-space indent, single quotes, minimal semicolons (match what's already in the file).
- Use `rg` / `grep` / `glob` to inspect the current code before editing.
- Keep commits and the Completion Note easy for another agent to review.

## When You're Stuck

If the task is unclear or something in DESIGN seems wrong, stop and leave a note in the task file under a `## Questions` section — don't guess your way forward on a decision that belongs to the Coordinator.
