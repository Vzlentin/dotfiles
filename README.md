# .agents

User-level agent skills and orchestration, tracked as a public repo that
**is** the `~/.agents` directory:

- **`skills/go/`** — an implementation-orchestration pipeline: give it an
  idea, a GitHub issue, or a plan file, and it drives the work end-to-end to
  a squash-merged PR (plan → issue → isolated worktree → implement → simplify
  → review → resolve feedback → CI loop → merge → persist outcome).
- **`skills/project-memory/`** — project-agnostic durable memory backed by an
  Obsidian vault, with a repo-relative `docs/plans/` fallback for plans.
- **`campaign/campaign.sh`** — a serial queue drain: pulls the next issue off
  a labeled GitHub queue and runs `/go` on it in a fresh agent pane, one unit
  at a time, keyed on the run-state contract below.

Skills not listed in `.gitignore`'s allowlist (third-party, CLI-managed) stay
untracked; `.skill-lock.json` is the tracked manifest to restore them.

## Install

```bash
git clone https://github.com/Vzlentin/.agents "$HOME/.agents"
```

On Windows with WSL, keep one working copy and symlink the WSL home to it:

```bash
ln -s /mnt/c/Users/<user>/.agents "$HOME/.agents"
```

Skill discovery: harnesses that walk `~/.agents/skills` (omp, Codex) pick the
skills up from the user home in any repo.

## Per-project configuration

The go skill is project-agnostic; each target repo declares its specifics in
a committed `.agents/config.toml`:

```toml
[go]
quality_gates = ["uv run ruff check .", "uv run pytest"]  # gate commands, in order
venv_gate = "uv run python -c 'import mypackage'"          # proves the env works

[go.data]
bigdataset = "data/big"   # named data requirement -> repo-relative path
```

A missing config means generic defaults: no venv gate, no data checks, and
quality gates discovered from the project's own docs/CI. Worktree setup steps
are read from the project's `.cursor/worktrees.json` (`setup-worktree-unix`)
when present.

## The /go run-state contract

Each `/go` run keeps one flat JSON dict at
`<git-common-dir>/go-runs/<slug>.json` — inside `.git`, so private by
construction and shared between the main checkout and its worktrees. Two keys
are mandatory:

- **`issue`** — the backing GitHub issue number, recorded at Stage 0c.
- **`outcome`** — the terminal outcome, recorded at Stage 6:
  `shipped` | `failed` | `ready-for-external-gates`.

An outer loop reads exactly those two keys to advance its queue; a settled
run with no `outcome` is treated as a crash. Manage state with
`skills/go/scripts/run_state.py` (`init` / `set` / `get` / `list`).

## Campaign usage

```bash
campaign/campaign.sh [--dry-run] <config.env>
```

The config is sourced bash; see the header of
[`campaign/campaign.sh`](campaign/campaign.sh) for the required variables
(`REPO`, `WORKREPO`, queue/claim labels, the `NEXT_ISSUE_JQ` ordering
expression, plan/log paths, prompt template). Keep instance configs
**outside** the repo (e.g. `~/.config/agents/campaigns/<name>.env`) — they may
carry private paths. `--dry-run` resolves the config and the next queue issue
without claiming anything or launching panes.

Requires `gh` (authed), `jq`, `herdr`, and `omp` at run time.

## Development

```bash
pip install pytest   # or: uv sync
pytest
shellcheck campaign/*.sh
```

CI runs the pytest suite on Ubuntu and Windows, plus shellcheck.
