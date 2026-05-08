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

- **Claim**: create your worktree first, `cd` into it, then rename the task file to `(doing)<ID>.md` and commit that rename as the **first commit** on `task/<ID>`. The rename must live on the task branch — never rename in the `master` working tree. If the file already has a `(doing)` or `(done)` prefix on `master`, someone else has it — don't take it.
- **Finish**: when done and self-tested, rename to `(done)<ID>.md`, append a **Completion Note** to the task body, and commit that rename+note as its own commit on `task/<ID>`. Leave the file in `project-docs/TASKS/` — do **not** move to `done/`; that's the Coordinator's step after merge.
- **Don't skip states**: no writing code before the `(doing)` rename commit; no moving to `done/` yourself.

## Git Worktree Workflow

Every task lands on its **own** branch in its **own** worktree. **No exceptions** — don't work on `master`, even if the task looks tiny. This keeps agents isolated and keeps `master`'s working tree clean for the Coordinator.

From the repo root (`multi-agent-system/multi-agent-system/`):

```bash
# 1. Create branch + worktree off master
git worktree add ../wt/<ID> -b task/<ID>

# 2. Move in — ALL subsequent work happens here, not in the main checkout
cd ../wt/<ID>

# 3. Claim: rename the task file and commit as the FIRST commit on the branch
git mv project-docs/TASKS/<ID>.md "project-docs/TASKS/(doing)<ID>.md"
git commit -m "chore: claim <ID>"

# 4. Do the work; commit to task/<ID> AS YOU GO (not only at the end)
git add <files>
git commit -m "<conventional commit message>"
```

Branch naming: `task/<ID>` (lowercase, matches the task ID, e.g. `task/a4-tool-autoregistry`).
Worktree path: `../wt/<ID>/` (sibling to the main repo checkout).

### Before you report complete — hard checklist

All must be true. If any fails, you are **not** done:

- [ ] Every code change is committed to `task/<ID>` (no unstaged, no untracked residue)
- [ ] `(done)<ID>.md` with Completion Note appended is committed on `task/<ID>`
- [ ] `git status` inside the worktree prints "nothing to commit, working tree clean"
- [ ] `git log master..task/<ID> --oneline` prints at least one commit (otherwise the Coordinator has nothing to review)
- [ ] You did **not** merge into `master` — that's the Coordinator's job
- [ ] The worktree is left in place for the Coordinator to inspect

Only after every box is checked may you report the task as complete. "Code is written" ≠ "task is complete" — unless it's in a commit on the task branch, it doesn't exist as far as the Coordinator is concerned.

## Commit Hygiene

- Prefer a small number of **coherent** commits over one giant commit. Each commit should be independently understandable.
- Conventional-style prefixes are encouraged: `feat(core): ...`, `fix(web): ...`, `docs: ...`, `test: ...`.
- Don't skip hooks (`--no-verify`, `--no-gpg-sign`) unless explicitly told.
- Never force-push.
- **Commit identity**: use the project owner's name/email inline — do **not** touch global `git config`. Prefix every commit with:

  ```bash
  git -c user.name="Your Name" -c user.email="you@example.com" commit -m "..."
  ```

  Same for `git -c ... merge` if you ever need it (you shouldn't — merging is the Coordinator's job).

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
