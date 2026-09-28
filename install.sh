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

target_path_for() {
    case $1 in
        .config|.config/*)           printf '%s\n' "$CONFIG_HOME${1#.config}" ;;
        .cache|.cache/*)             printf '%s\n' "$CACHE_HOME${1#.cache}" ;;
        .local/share|.local/share/*) printf '%s\n' "$DATA_HOME${1#.local/share}" ;;
        .local/state|.local/state/*) printf '%s\n' "$STATE_HOME${1#.local/state}" ;;
        *)                           printf '%s\n' "$HOME/$1" ;;
    esac
}

# Remove only links into this checkout whose source is gone; other links are not ours.
remove_stale_links() {
    find "$@" \( -name node_modules -o -name .git \) -prune -o -type l -print |
        while IFS= read -r link_path; do
            source_path=$(readlink "$link_path")
            case $source_path in
                "$SOURCE_DIR"/*) ;;
                *) continue ;;
            esac
            if [ ! -e "$source_path" ] && [ ! -L "$source_path" ]; then
                rm -f "$link_path"
                echo "remove ${link_path#"$HOME/"}"
            fi
        done
}

link_file() {
    source_path=$1
    relative_path=${source_path#"$SOURCE_DIR/"}
    target_path=$(target_path_for "$relative_path")

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

printf '\n==> Removing stale dotfile links\n'
remove_stale_links "$HOME" -maxdepth 1
for source_root in "$SOURCE_DIR"/.[!.]* "$SOURCE_DIR"/*; do
    if [ -d "$source_root" ] && [ ! -L "$source_root" ]; then
        target_root=$(target_path_for "${source_root#"$SOURCE_DIR/"}")
        if [ -d "$target_root" ]; then
            remove_stale_links "$target_root"
        fi
    fi
done

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
