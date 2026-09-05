#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd "$(dirname "$0")" && pwd)
"$SCRIPT_DIR/bootstrap.sh"
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

find "$SOURCE_DIR" \( -type f -o -type l \) | while IFS= read -r source_path; do
    link_file "$source_path"
done

# Install dependencies beside linked agent-skill sources so Node's module
# resolution follows the links back to a complete package.
if [ -d "$SOURCE_DIR/.agents" ]; then
    find "$SOURCE_DIR/.agents" -name package-lock.json -type f | while IFS= read -r lockfile; do
        package_dir=$(dirname "$lockfile")
        if [ -f "$package_dir/package.json" ]; then
            echo "install dependencies ${package_dir#"$SOURCE_DIR/"}"
            npm ci --prefix "$package_dir"
        fi
    done
fi

# Install campaign beside dotfiles; leave existing source checkouts untouched.
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 22 || (major === 22 && minor < 19)) { console.error("campaign requires Node 22.19 or newer; upgrade Node first."); process.exit(1); }'
campaign_repo="$SCRIPT_DIR/../pi-dspy-gepa-workflows"
if [ ! -e "$campaign_repo" ]; then
    git clone https://github.com/Vzlentin/pi-dspy-gepa-workflows.git "$campaign_repo"
fi
(
    cd "$campaign_repo"
    npm ci
    uv sync --frozen
    npm_config_prefix="$HOME/.local" npm link
)
"$HOME/.local/bin/campaign" --help

if [ ! -f "$HOME/.zprofile.local" ]; then
    echo ""
    echo "Tip: use $HOME/.zprofile.local for machine-specific environment and secrets."
fi

if [ ! -f "$HOME/.zshrc.local" ]; then
    echo "Tip: use $HOME/.zshrc.local for machine-specific interactive settings."
fi
