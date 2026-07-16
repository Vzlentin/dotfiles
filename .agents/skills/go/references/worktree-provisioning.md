# Stage 0d — mode and provisioning rationale

The git-state read, mode decision, and provisioning mechanics live in
`$SKILL_DIR/scripts/provision_worktree.py` (`decide` / `provision`);
SKILL.md's Stage 0d owns the GATE. This file keeps the judgment behind them.

## Why the mode split

DIRECT mode (on `main` and clean) lets `ce-work` branch inside the main
checkout — cheapest path, nothing to preserve. Any other state — another
branch, detached HEAD, or a dirty tree — means the user's checkout carries
context that must not move, so WORKTREE mode cuts an isolated worktree on a
fresh branch from `origin/main`. The script reads clean/dirty via
`git status --porcelain` through Python's subprocess, which bypasses the MSYS
wrapper trap that motivated the old full-text detector (see
`references/environment.md`).

The setup steps are **defined in the project's `.cursor/worktrees.json`**
under `setup-worktree-unix` — the script reads them dynamically (never
hardcoded) so a config change is picked up, substituting `$ROOT_WORKTREE_PATH`
with the main checkout path (Cursor injects that var; the script supplies it
itself). A project without that file gets a plain `git worktree add` with no
setup steps.

Environment-manager caveats (e.g. uv): a *warm* dependency sync in a fresh
worktree takes seconds when the package cache is shared; **never** copy the
main virtualenv between worktrees (it is typically non-relocatable — absolute
paths in its config and scripts).

Setup steps can fail in ways a zero exit code hides (an `|| true` guard, a
partially-populated environment). If a provisioned worktree behaves oddly at
Stage 1, smoke-test the environment (an import check, a compile check) before
blaming the implementation.
