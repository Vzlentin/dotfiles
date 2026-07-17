# AGENTS.md

Instructions for agents working on this repository — the published dotfiles
repo. The root mirrors `$HOME`; `install.sh` symlinks the payloads into the
home directory.

## Layout

- `.agents/skills/go/` — the /go orchestration skill: `SKILL.md`, `scripts/`
 (stdlib Python helpers), `references/` (stage and environment docs;
 `references/harness/pi.md` is the only home for harness-specific
 subagent-launch recipes — SKILL.md stays harness-abstract).
- `.agents/skills/{plan,implement,simplify,review,resolve-review,babysit}/`
 — the six stage skills /go delegates to, each standalone-invocable.
 `review/references/personas/` is the review persona catalog (the
 thermo-nuclear rubric is vendored MIT content — keep its license notice);
 `resolve-review/scripts/` holds the gh GraphQL thread helpers (bash).
- `.agents/agents/` — canonical pi-subagents agent definitions
 (`implementer.md`, `hands.md`, `analyst.md`), symlinked by `install.sh` into
 `~/.pi/agent/agents/`.
- `.agents/skills/project-memory/` — the project-memory skill.
- `.agents/.skill-lock.json` — manifest for restoring untracked CLI-managed
 skills.
- `.local/bin/campaign` — the serial campaign queue-drain loop (bash).
- `install.sh` — idempotent symlinks into `$HOME`.
- `tests/` — pytest suite covering the go scripts.
- `.github/`, `pyproject.toml` — dev tooling at the root, not deployed.

## Test and lint

```bash
pytest
ruff check .
shellcheck .local/bin/campaign install.sh .agents/skills/resolve-review/scripts/*
```

All three run in CI (pytest on Ubuntu and Windows).

## Conventions

- Tracking is a default-deny allowlist (`.gitignore` starts with `/*`).
  A new tracked file needs its own `!` entry; config dirs (`.codex/`,
  `.omp/`, `.config/`) allowlist individual files, never whole dirs. A new
  tracked skill needs its own `!/.agents/skills/<name>/` entry.
- Python scripts are stdlib-only (≥ 3.11) and open with a docstring header
  documenting usage and behavior. Keep the headers accurate — the README
  links to them as the reference.
- Shell scripts are bash, shellcheck-clean, and open with a comment header
  documenting usage and behavior (same rule as the Python headers).
- This is a public repo: no private paths, client context, or
  machine-specific configuration in tracked files.
- Edits on this Windows machine: see
  [.agents/skills/go/references/environment.md](.agents/skills/go/references/environment.md)
  for the PowerShell 5.1 encoding trap — never bulk-rewrite files via
  `Get-Content`/`Set-Content`.
