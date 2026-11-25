#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd "$(dirname "$0")" && pwd)
"$SCRIPT_DIR/bootstrap.sh" "$@"

SOURCE_DIR="$SCRIPT_DIR/home"
CONFIG_HOME=${XDG_CONFIG_HOME:-"$HOME/.config"}
CACHE_HOME=${XDG_CACHE_HOME:-"$HOME/.cache"}
DATA_HOME=${XDG_DATA_HOME:-"$HOME/.local/share"}
STATE_HOME=${XDG_STATE_HOME:-"$HOME/.local/state"}

# Some tools require the parent of their configured file to exist.
for directory in \
    "$CONFIG_HOME/npm" \
    "$STATE_HOME/node" \
    "$STATE_HOME/python"
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

# Tracked and new files; Git-ignored files such as node_modules are never linked.
linkable_paths=$(git -C "$SCRIPT_DIR" -c core.quotePath=false \
    ls-files --cached --others --exclude-standard -- home)

is_linkable() {
    { [ -e "$1" ] || [ -L "$1" ]; } &&
        printf '%s\n' "$linkable_paths" | grep -Fqx -- "${1#"$SCRIPT_DIR/"}"
}

# Remove only links into this checkout whose source is gone or ignored; other links are not ours.
remove_stale_links() {
    find "$@" \( -name node_modules -o -name .git \) -prune -o -type l -print |
        while IFS= read -r link_path; do
            source_path=$(readlink "$link_path")
            case $source_path in
                "$SOURCE_DIR"/*) ;;
                *) continue ;;
            esac
            if ! is_linkable "$source_path"; then
                rm -f "$link_path"
                echo "remove ${link_path#"$HOME/"}"
                # rmdir removes only empty folders, so this stops at the first one in use.
                parent=$(dirname "$link_path")
                while [ "$parent" != "$HOME" ] && rmdir "$parent" 2>/dev/null; do
                    parent=$(dirname "$parent")
                done
            fi
        done
}

link_file() {
    source_path=$1
    relative_path=${source_path#"$SOURCE_DIR/"}
    target_path=$(target_path_for "$relative_path")

    if [ -L "$target_path" ] && [ "$(readlink "$target_path")" = "$source_path" ]; then
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

printf '\n==> Linking dotfiles\n'
printf '%s\n' "$linkable_paths" | while IFS= read -r relative_path; do
    if is_linkable "$SCRIPT_DIR/$relative_path"; then
        link_file "$SCRIPT_DIR/$relative_path"
    fi
done

# npx installs the skills of public repositories and records them in its own
# lock file, outside this checkout. The lock is the list of the skills that npx
# keeps: each run updates the listed skills, adds the missing ones, and removes
# the others. A link in ~/.agents/skills stays as it is, such as a link to a
# checkout of Vzlentin/skills. This runs after the links, so that npx never
# writes through a stale link into this checkout.
SKILL_LOCK="$STATE_HOME/skills/.skill-lock.json"

# Each line: <repository> <skill>.
wanted_skills() {
    echo Vzlentin/skills show-me
    echo Vzlentin/skills artifacts
    echo Vzlentin/skills writing-pr
    echo Vzlentin/skills chief-of-staff
    echo mattpocock/skills handoff
    echo mitsuhiko/agent-stuff librarian
    echo AVGVSTVS96/better-github-skill better-github-skill
    if [ "$(uname -s)" = Darwin ]; then
        echo Vzlentin/skills dia
    fi
}

locked_skills() {
    if [ -f "$SKILL_LOCK" ]; then
        node -e 'for (const name of Object.keys(require(process.argv[1]).skills ?? {})) console.log(name)' "$SKILL_LOCK"
    fi
}

skills_cli() {
    (cd "$HOME" && npx --yes skills "$@")
}

sync_skills() {
    wanted=$(wanted_skills)
    locked=$(locked_skills)

    for skill in $locked; do
        if ! printf '%s\n' "$wanted" | grep -q " $skill\$" && [ ! -L "$HOME/.agents/skills/$skill" ]; then
            skills_cli remove --global --yes "$skill"
        fi
    done

    printf '%s\n' "$wanted" | while read -r repository skill; do
        if [ -L "$HOME/.agents/skills/$skill" ] || printf '%s\n' "$locked" | grep -Fqx "$skill"; then
            continue
        fi
        skills_cli add "$repository" --global --agent pi --skill "$skill" --yes
    done

    updates=
    for skill in $locked; do
        if printf '%s\n' "$wanted" | grep -q " $skill\$" && [ ! -L "$HOME/.agents/skills/$skill" ]; then
            updates="$updates $skill"
        fi
    done
    if [ -n "$updates" ]; then
        # shellcheck disable=SC2086
        skills_cli update --global --yes $updates
    fi
}

if [ "${1:-}" != --minimal ]; then
    printf '\n==> Syncing skills from public repositories\n'
    sync_skills
    if [ "$(uname -s)" = Darwin ]; then
        if [ -d /Applications/Dia.app ] && [ ! -e "$HOME/Applications/Dia (JS).app" ]; then
            node "$HOME/.agents/skills/dia/dia.mjs" launcher
        fi
    fi
fi

printf '\n==> Installation complete\n'

if [ ! -f "$HOME/.zprofile.local" ]; then
    echo ""
    echo "Tip: use $HOME/.zprofile.local for machine-specific environment and secrets."
fi

if [ ! -f "$HOME/.zshrc.local" ]; then
    echo "Tip: use $HOME/.zshrc.local for machine-specific interactive settings."
fi
