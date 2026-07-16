#!/usr/bin/env bash
# install.sh — idempotent symlinks from $HOME into this dotfiles repo.
#
# Whole-dir symlink for ~/.agents; per-file symlinks for everything else
# (so untracked runtime state next to a tracked file never lands in the
# repo). Existing correct links are left alone; anything else in the way is
# moved aside to <path>.pre-dotfiles rather than deleted.
set -euo pipefail

REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

link() { # target link_path
  local target=$1 link=$2
  if [ -L "$link" ] && [ "$(readlink "$link")" = "$target" ]; then
    echo "ok      $link"
    return
  fi
  if [ -e "$link" ] || [ -L "$link" ]; then
    mv "$link" "$link.pre-dotfiles"
    echo "moved   $link -> $link.pre-dotfiles"
  fi
  mkdir -p "$(dirname "$link")"
  ln -s "$target" "$link"
  echo "linked  $link -> $target"
}

# Whole-dir: harnesses walk ~/.agents/skills, and untracked CLI-managed
# skills live alongside the tracked ones.
link "$REPO/.agents" "$HOME/.agents"

# Per-file payloads.
link "$REPO/.local/bin/campaign" "$HOME/.local/bin/campaign"

# pi-subagents agent definitions: canonical copies live in .agents/agents/,
# discovered by pi-subagents at ~/.pi/agent/agents/. Per-file so untracked
# agents added by the CLI never land in the repo.
for agent in "$REPO/.agents/agents/"*.md; do
  link "$agent" "$HOME/.pi/agent/agents/$(basename "$agent")"
done

# ~/.codex, ~/.omp, ~/.config entries get their own `link` line here as
# files are curated into the allowlist, e.g.:
#   link "$REPO/.codex/config.toml" "$HOME/.codex/config.toml"
