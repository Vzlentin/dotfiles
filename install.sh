#!/bin/sh
set -eu
export npm_config_progress=false npm_config_foreground_scripts=true
export npm_config_loglevel=info npm_config_audit=false npm_config_fund=false

SCRIPT_DIR=$(CDPATH= cd "$(dirname "$0")" && pwd)
"$SCRIPT_DIR/bootstrap.sh" "$@"
export PATH="$HOME/.local/bin:$PATH"

SOURCE_DIR="$SCRIPT_DIR/home"
CONFIG_HOME=${XDG_CONFIG_HOME:-"$HOME/.config"}
CACHE_HOME=${XDG_CACHE_HOME:-"$HOME/.cache"}
DATA_HOME=${XDG_DATA_HOME:-"$HOME/.local/share"}
STATE_HOME=${XDG_STATE_HOME:-"$HOME/.local/state"}

# Some tools require the parent of their configured file to exist.
for directory in \
    "$CONFIG_HOME/npm" \
    "$CACHE_HOME/zsh" \
    "$DATA_HOME" \
    "$STATE_HOME/node" \
    "$STATE_HOME/python" \
    "$STATE_HOME/zsh"
do
    mkdir -p "$directory"
done

link_file() {
    source_path=$1
    relative_path=${source_path#"$SOURCE_DIR/"}
    case $relative_path in
        .config/*)      target_path="$CONFIG_HOME/${relative_path#.config/}" ;;
        .cache/*)       target_path="$CACHE_HOME/${relative_path#.cache/}" ;;
        .local/share/*) target_path="$DATA_HOME/${relative_path#.local/share/}" ;;
        .local/state/*) target_path="$STATE_HOME/${relative_path#.local/state/}" ;;
        *)             target_path="$HOME/$relative_path" ;;
    esac

    if [ -L "$target_path" ] && [ "$(readlink "$target_path")" = "$source_path" ]; then
        echo "skip $relative_path"
        return
    fi

    if [ -L "$target_path" ] || [ -e "$target_path" ]; then
        rm -rf "$target_path"
        echo "replace $relative_path"
    fi

    mkdir -p "$(dirname "$target_path")"
    ln -s "$source_path" "$target_path"
    echo "link $relative_path"
}

printf '\n==> Linking dotfiles (excluding node_modules and .git)\n'
find "$SOURCE_DIR" \( -name node_modules -o -name .git \) -prune -o \
    \( -type f -o -type l \) -print | while IFS= read -r source_path; do
    link_file "$source_path"
done

if [ "${1:-}" = --minimal ]; then
    printf '\n==> Minimal installation complete; skipping campaign\n'
    exit 0
fi

# Install campaign beside dotfiles; leave existing source checkouts untouched.
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 22 || (major === 22 && minor < 19)) { console.error("campaign requires Node 22.19 or newer; upgrade Node first."); process.exit(1); }'
campaign_repo="$SCRIPT_DIR/../pi-dspy-gepa-workflows"
if [ ! -e "$campaign_repo" ]; then
    printf '\n==> Cloning campaign\n'
    git clone https://github.com/Vzlentin/pi-dspy-gepa-workflows.git "$campaign_repo"
fi
(
    cd "$campaign_repo"
    printf '\n==> Installing campaign Node dependencies\n'
    npm ci
    printf '\n==> Installing campaign Python dependencies\n'
    uv sync --frozen --verbose
    printf '\n==> Linking campaign CLI\n'
    npm_config_prefix="$HOME/.local" npm link
)
printf '\n==> Checking campaign CLI\n'
"$HOME/.local/bin/campaign" --help
printf '\n==> Installation complete\n'

if [ ! -f "$HOME/.zprofile.local" ]; then
    echo ""
    echo "Tip: use $HOME/.zprofile.local for machine-specific environment and secrets."
fi

if [ ! -f "$HOME/.zshrc.local" ]; then
    echo "Tip: use $HOME/.zshrc.local for machine-specific interactive settings."
fi
