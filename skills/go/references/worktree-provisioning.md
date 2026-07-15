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

## Environment and data gates

The project declares its gates in `<repo>/.agents/config.toml` (`[go]`
table): `venv_gate` is a command that proves the provisioned environment
actually works (an import smoke test, a compile check), and `[go.data]` maps
requirement names to repo-relative paths for datasets a work item may depend
on.

Setup steps often guard data provisioning with `test -d … || true`, which
**swallows a failed copy/link** — a data-less worktree then provisions
"successfully". The real catch is the script's `--require-data <name>` gate
for data-dependent items (the venv gate passes without data), per SKILL.md's
Stage 0d data-presence GATE. Large datasets are best linked (symlink/junction)
rather than copied into every worktree when they are read-only for the
pipeline; declare each in `[go.data]` so the gate can verify presence.
