#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd "$(dirname "$0")" && pwd)
SOURCE_DIR="$SCRIPT_DIR/home"
BACKUP_DIR="$HOME/.dotfiles-backup/$(date +%Y%m%d%H%M%S)"
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
    "$STATE_HOME/vim" \
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

    if [ -L "$target_path" ]; then
        case $(readlink "$target_path") in
            "$SOURCE_DIR"/*)
                rm "$target_path"
                echo "relink $relative_path"
                ;;
            *)
                backup_path="$BACKUP_DIR/$relative_path"
                mkdir -p "$(dirname "$backup_path")"
                mv "$target_path" "$backup_path"
                echo "backup $relative_path -> $backup_path"
                ;;
        esac
    elif [ -e "$target_path" ]; then
        backup_path="$BACKUP_DIR/$relative_path"
        mkdir -p "$(dirname "$backup_path")"
        mv "$target_path" "$backup_path"
        echo "backup $relative_path -> $backup_path"
    fi

    mkdir -p "$(dirname "$target_path")"
    ln -s "$source_path" "$target_path"
    echo "link $relative_path"
}

find "$SOURCE_DIR" -type f | while IFS= read -r source_path; do
    link_file "$source_path"
done

if [ ! -f "$HOME/.zprofile.local" ]; then
    echo ""
    echo "Tip: use $HOME/.zprofile.local for machine-specific environment and secrets."
fi

if [ ! -f "$HOME/.zshrc.local" ]; then
    echo "Tip: use $HOME/.zshrc.local for machine-specific interactive settings."
fi
