# dotfiles

Personal dotfiles, published as reference. The repo root mirrors `$HOME` for
the deployed dot-entries; dev tooling (tests, CI config) stays at the root
and is not deployed. Tracking is a **default-deny allowlist**: nothing is
committed unless `.gitignore` explicitly lists it, so tokens, auth, and
runtime state can't land here by accident.

The interesting parts:

- **`.agents/skills/go/`** — an implementation-orchestration pipeline: give
  it an idea, a GitHub issue, or a plan file, and it drives the work
  end-to-end to a squash-merged PR (plan + issue → isolated worktree →
  implement → simplify → review → resolve feedback → babysit CI → merge →
  persist outcome). Each stage delegates to one of the stage skills below;
  harness specifics (how subagents launch on pi +
  [pi-subagents](https://github.com/edxeth/pi-subagents)) are isolated in
  `references/harness/pi.md`, so supporting another harness is adding one
  file.
- **Six stage skills**, each standalone-invocable and pipeline-friendly:
  `plan/` (zero-context-executor unit plans, headless-safe), `implement/`
  (TDD to a pushed PR with `closes #N`), `simplify/` (three read-only lenses
  over the branch diff), `review/` (persona scout panel posting resolvable
  PR threads, with a vendored thermo-nuclear rubric as the harsh
  maintainability persona), `resolve-review/` (central legitimacy gate,
  fix/reply/resolve via `gh` GraphQL), and `babysit/` (bounded
  conflicts/comments/CI loop — it never merges).
- **`.agents/agents/`** — canonical pi-subagents agent definitions: an
  interactive full-capability `implementer` that inherits the parent model, an
  interactive `hands` agent for bounded mechanical execution pinned to Luna
  xhigh, a read-only background `scout` pinned to Terra low, and a versatile
  full-capability `worker` pinned to Kimi K3 high. `install.sh` symlinks them
  into `~/.pi/agent/agents/`; `/go` names its pipeline roles without carrying
  model policy.
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
any repo) and each other payload per-file (`~/.local/bin/campaign`, plus each
agent definition into `~/.pi/agent/agents/`). Anything already in the way is
moved aside to `<path>.pre-dotfiles`, never deleted.

Untracked (CLI-managed) skills are restorable from the tracked
`.agents/.skill-lock.json` manifest.

## Campaign

```bash
campaign <name>     # from inside the work repo
```

A campaign is a state directory in the vault project folder
(`$OBSIDIAN_VAULT_PATH/Projects/<project>/campaigns/<name>/`): a
hand-maintained `queue` (one unit per line), an optional `config`
(`plan=…`, `timeout_h=…`, `agent_cmd=…`), and a machine-appended `log.jsonl`
ledger. The loop picks the first queue unit without a shipped ledger entry,
launches `/go <unit>` via the configured agent command (default `pi`) in a
fresh agent pane, polls the `/go` run state until a fresh terminal outcome
appears (or the per-unit timeout expires), appends the ledger, and stops on
anything non-shipped — so a re-run naturally retries the failed unit. Full
behavior and the campaign-dir format are documented in the header of
[`.local/bin/campaign`](.local/bin/campaign).

The loop keys on the `/go` run-state contract (`issue` and `outcome` in
`<git-common-dir>/go-runs/<slug>.json`); see
[.agents/skills/go/SKILL.md](.agents/skills/go/SKILL.md).

Requires on PATH: `git`, `jq`, `herdr` (agent panes), `python3`, and the
configured agent command (default `pi`).

## Live graph prototype

Variant A (Metro/Rails) is state-aware: expanding an active, takeable, or
pending Decision or Work Item splices its Actor Graph left-to-right into the
Campaign route and shifts downstream nodes right. Expanding a done or failed
parent keeps the Campaign rail compact and shows the historical Actor Graph
vertically beneath that parent. Actor fan-out and joins remain visible in both
modes. Only one compound node expands at a time; layout is automatic and does
not store coordinates.

Variants B and C keep their existing expansion behavior.

## Development

```bash
pip install pytest ruff   # or: uv sync
pytest
ruff check .
shellcheck .local/bin/campaign install.sh .agents/skills/resolve-review/scripts/*
```

CI runs the pytest suite on Ubuntu and Windows, plus ruff and shellcheck.
