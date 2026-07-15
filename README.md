# .agents

A personal `~/.agents` directory published as reference. The interesting
parts:

- **`skills/go/`** — an implementation-orchestration pipeline: give it an
  idea, a GitHub issue, or a plan file, and it drives the work end-to-end to
  a squash-merged PR (plan → issue → isolated worktree → implement → simplify
  → review → resolve feedback → CI loop → merge → persist outcome).
- **`skills/project-memory/`** — project-agnostic durable memory backed by an
  Obsidian vault, with a repo-relative `docs/plans/` fallback for plans.
- **`campaign/campaign.py`** — a serial queue drain: pulls the next issue off
  a labeled GitHub queue and runs `/go` on it in a fresh agent pane, one unit
  at a time.

## Requirements

- **`gh`** (authenticated) — issue queue and PR operations.
- **`herdr`** — launches and monitors the agent panes the campaign loop runs
  units in.
- **`omp`** — the agent harness that executes `/go` inside each pane.
- **Python ≥ 3.11** — every script is stdlib-only; nothing to install.

## Install

Clone to `~/.agents` only if you don't already have one:

```bash
git clone https://github.com/Vzlentin/.agents "$HOME/.agents"
```

If you already have a `~/.agents`, fork this repo instead, or copy the
`skills/` you want into your existing directory. Harnesses that walk
`~/.agents/skills` (omp, Codex) pick the skills up from the user home in any
repo.

Untracked (CLI-managed) skills are restorable from the tracked
`.skill-lock.json` manifest.

## Per-project configuration

Each target repo declares its specifics in a committed `.agents/config.toml`.
Everything is optional; a missing file or table means defaults:

```toml
[go]
quality_gates = ["uv run ruff check .", "uv run pytest"]  # gate commands, in order
setup_check = "uv run python -c 'import mypackage'"       # proves the provisioned env works

[campaign]
queue_label = "queue"            # label marking issues ready to run
claim_label = "claimed"          # label added when a unit is claimed
title_filter = "^U\\d+"          # only issues whose title matches are eligible
plan = "docs/plans/campaign.md"  # campaign plan, repo-relative
log = "docs/plans/campaign-log.md"
```

Deep details live next to the code: the go skill docs
([skills/go/references/worktree-provisioning.md](skills/go/references/worktree-provisioning.md))
for `[go]`, and the header of
[`campaign/campaign.py`](campaign/campaign.py) for `[campaign]`.

## Campaign

```bash
python campaign/campaign.py <workrepo>
```

Drains the labeled issue queue of `<workrepo>`'s origin repo: claims the next
issue, launches `/go` on it in a fresh agent pane, waits for the outcome, and
stops on the first non-shipped unit. All config keys, their defaults, and the
`CAMPAIGN_PLAN` / `CAMPAIGN_LOG` env overrides are documented in the header
of [`campaign/campaign.py`](campaign/campaign.py).

The loop keys on the `/go` run-state contract (`issue` and `outcome` in
`<git-common-dir>/go-runs/<slug>.json`); see
[skills/go/SKILL.md](skills/go/SKILL.md).

## Development

```bash
pip install pytest ruff   # or: uv sync
pytest
ruff check .
```

CI runs the pytest suite on Ubuntu and Windows, plus ruff.
