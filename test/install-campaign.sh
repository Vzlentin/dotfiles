#!/bin/sh
set -eu

SOURCE=$(CDPATH= cd "$(dirname "$0")/.." && pwd)
ROOT=$(mktemp -d)
trap 'rm -rf "$ROOT"' EXIT HUP INT TERM
export HOME="$ROOT/home" TEST_LOG="$ROOT/commands"
export XDG_CONFIG_HOME="$HOME/.config" XDG_CACHE_HOME="$HOME/.cache"
export XDG_DATA_HOME="$HOME/.local/share" XDG_STATE_HOME="$HOME/.local/state"
mkdir -p "$ROOT/dotfiles/home/.config" "$ROOT/bin" "$HOME/.local/bin"
cp "$SOURCE/install.sh" "$ROOT/dotfiles/"
printf '#!/bin/sh\nexit 0\n' > "$ROOT/dotfiles/bootstrap.sh"
chmod +x "$ROOT/dotfiles/bootstrap.sh"
printf 'dotfile\n' > "$ROOT/dotfiles/home/.config/campaign-test"
export PATH="$ROOT/bin:$PATH"

cat > "$ROOT/bin/git" <<'SH'
#!/bin/sh
set -eu
[ "$1" = clone ]
[ "$2" = https://github.com/Vzlentin/pi-dspy-gepa-workflows.git ]
mkdir -p "$3/.git"
printf 'clone\n' >> "$TEST_LOG"
SH
cat > "$ROOT/bin/npm" <<'SH'
#!/bin/sh
set -eu
[ "$(basename "$PWD")" = pi-dspy-gepa-workflows ]
case "$1" in
    ci) printf 'ci\n' >> "$TEST_LOG" ;;
    link)
        [ "$npm_config_prefix" = "$HOME/.local" ]
        printf 'link\n' >> "$TEST_LOG"
        printf '#!/bin/sh\n[ "$1" = --help ]\n' > "$HOME/.local/bin/campaign"
        chmod +x "$HOME/.local/bin/campaign"
        ;;
    *) exit 1 ;;
esac
SH
cat > "$ROOT/bin/uv" <<'SH'
#!/bin/sh
set -eu
[ "$*" = 'sync --frozen' ]
printf 'sync\n' >> "$TEST_LOG"
exit "${TEST_UV_EXIT:-0}"
SH
chmod +x "$ROOT/bin/git" "$ROOT/bin/npm" "$ROOT/bin/uv"

sh "$ROOT/dotfiles/install.sh"
[ "$(readlink "$XDG_CONFIG_HOME/campaign-test")" = "$ROOT/dotfiles/home/.config/campaign-test" ]
[ "$(cat "$TEST_LOG")" = "$(printf 'clone\nci\nsync\nlink')" ]
printf 'local work\n' > "$ROOT/pi-dspy-gepa-workflows/local.txt"
sh "$ROOT/dotfiles/install.sh"
[ "$(grep -c '^clone$' "$TEST_LOG")" -eq 1 ]
[ "$(grep -c '^link$' "$TEST_LOG")" -eq 2 ]
[ "$(cat "$ROOT/pi-dspy-gepa-workflows/local.txt")" = 'local work' ]

if TEST_UV_EXIT=42 sh "$ROOT/dotfiles/install.sh"; then
    echo 'Installer ignored a failed dependency sync' >&2
    exit 1
fi
[ "$(grep -c '^link$' "$TEST_LOG")" -eq 2 ]
printf 'Campaign installer smoke test passed.\n'
