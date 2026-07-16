# dotfiles

Personal dotfiles, published as reference. The repo root mirrors `$HOME` for
the deployed dot-entries; dev tooling (tests, CI config) stays at the root
and is not deployed. Tracking is a **default-deny allowlist**: nothing is
committed unless `.gitignore` explicitly lists it, so tokens, auth, and
runtime state can't land here by accident.

The interesting parts:

- **`.agents/skills/go/`** — an implementation-orchestration pipeline: give
  it an idea, a GitHub issue, or a plan file, and it drives the work
  end-to-end to a squash-merged PR (plan → issue → isolated worktree →
  implement → simplify → review → resolve feedback → CI loop → merge →
  persist outcome).
- **`.agents/skills/project-memory/`** — project-agnostic durable memory
  backed by an Obsidian vault, with a repo-relative `docs/plans/` fallback
  for plans.
- **`.local/bin/campaign`** — a serial queue drain: runs the next unit of a
  hand-maintained campaign queue through `/go` in a fresh agent pane, one
  unit at a time, stopping on the first non-shipped outcome.

## Install

```bash
git clone https://github.com/Vzlentin/dotfiles ~/dotfiles
~/dotfiles/install.sh
```

`install.sh` is idempotent: it symlinks `~/.agents` to the repo's `.agents/`
(whole-dir — harnesses that walk `~/.agents/skills` pick the skills up in
any repo) and each other payload per-file (`~/.local/bin/campaign`, …).
Anything already in the way is moved aside to `<path>.pre-dotfiles`, never
deleted.

Untracked (CLI-managed) skills are restorable from the tracked
`.agents/.skill-lock.json` manifest.

## Campaign

```bash
campaign <name>     # from inside the work repo
```

A campaign is a state directory in the vault project folder
(`$OBSIDIAN_VAULT_PATH/Projects/<project>/campaigns/<name>/`): a
hand-maintained `queue` (one unit per line), an optional `config`
(`plan=…`, `timeout_h=…`), and a machine-appended `log.jsonl` ledger. The
loop picks the first queue unit without a shipped ledger entry, launches
`/go <unit>` in a fresh agent pane, blocks on a completion sentinel, reads
the unit's outcome from the `/go` run state, appends the ledger, and stops
on anything non-shipped — so a re-run naturally retries the failed unit.
Full behavior and the campaign-dir format are documented in the header of
[`.local/bin/campaign`](.local/bin/campaign).

The loop keys on the `/go` run-state contract (`issue` and `outcome` in
`<git-common-dir>/go-runs/<slug>.json`); see
[.agents/skills/go/SKILL.md](.agents/skills/go/SKILL.md).

Requires on PATH: `git`, `jq`, `herdr` (agent panes), `omp` (the agent
harness), `python3`.

## Development

```bash
pip install pytest ruff   # or: uv sync
pytest
ruff check .
shellcheck .local/bin/campaign install.sh
```

CI runs the pytest suite on Ubuntu and Windows, plus ruff and shellcheck.
