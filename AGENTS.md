# AGENTS.md

Instructions for agents working on this repository — the published
`~/.agents` directory itself.

## Layout

- `skills/go/` — the /go orchestration skill: `SKILL.md`, `scripts/`
  (stdlib Python helpers), `references/` (stage and environment docs).
- `skills/project-memory/` — the project-memory skill.
- `campaign/campaign.py` — the serial queue-drain loop.
- `tests/` — pytest suite covering the campaign loop and the go scripts.
- `.skill-lock.json` — manifest for restoring untracked CLI-managed skills.

## Test and lint

```bash
pytest
ruff check .
```

Both run in CI (pytest on Ubuntu and Windows).

## Conventions

- Scripts are stdlib-only Python ≥ 3.11 and open with a docstring header
  documenting usage and behavior. Keep the headers accurate — the README
  links to them as the config reference.
- Skills are untracked by default: `.gitignore` allowlists the tracked ones.
  A new tracked skill needs its own `!skills/<name>/` allowlist entry.
- This is a public repo: no private paths, client context, or
  machine-specific configuration in tracked files.
- Edits on this Windows machine: see
  [skills/go/references/environment.md](skills/go/references/environment.md)
  for the PowerShell 5.1 encoding trap — never bulk-rewrite files via
  `Get-Content`/`Set-Content`.
