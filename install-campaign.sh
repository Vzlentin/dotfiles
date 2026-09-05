#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd "$(dirname "$0")" && pwd)
REPO="$SCRIPT_DIR/../pi-dspy-gepa-workflows"
export PATH="$HOME/.local/bin:$PATH"

for tool in git node npm uv; do
    command -v "$tool" >/dev/null 2>&1 || {
        printf 'campaign requires %s; run bootstrap.sh first.\n' "$tool" >&2
        exit 1
    }
done
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 22 || (major === 22 && minor < 19)) { console.error("campaign requires Node 22.19 or newer; upgrade Node first."); process.exit(1); }'

# Keep existing checkouts untouched; update them explicitly with git pull.
if [ ! -e "$REPO" ]; then
    git clone https://github.com/Vzlentin/pi-dspy-gepa-workflows.git "$REPO"
fi
cd "$REPO"
npm ci
uv sync --frozen
npm_config_prefix="$HOME/.local" npm link
"$HOME/.local/bin/campaign" --help
