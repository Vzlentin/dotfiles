#!/bin/sh
set -eu

SOURCE=$(CDPATH= cd "$(dirname "$0")/.." && pwd)
ROOT=$(mktemp -d)
trap 'rm -rf "$ROOT"' EXIT HUP INT TERM
export HOME="$ROOT/home" TEST_LOG="$ROOT/commands"
mkdir -p "$ROOT/dotfiles" "$ROOT/bin" "$HOME/.local/bin"
cp "$SOURCE/install-campaign.sh" "$ROOT/dotfiles/"
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

sh "$ROOT/dotfiles/install-campaign.sh"
[ "$(cat "$TEST_LOG")" = "$(printf 'clone\nci\nsync\nlink')" ]
printf 'local work\n' > "$ROOT/pi-dspy-gepa-workflows/local.txt"
sh "$ROOT/dotfiles/install-campaign.sh"
[ "$(grep -c '^clone$' "$TEST_LOG")" -eq 1 ]
[ "$(grep -c '^link$' "$TEST_LOG")" -eq 2 ]
[ "$(cat "$ROOT/pi-dspy-gepa-workflows/local.txt")" = 'local work' ]

if TEST_UV_EXIT=42 sh "$ROOT/dotfiles/install-campaign.sh"; then
    echo 'Installer ignored a failed dependency sync' >&2
    exit 1
fi
[ "$(grep -c '^link$' "$TEST_LOG")" -eq 2 ]
printf 'Campaign installer smoke test passed.\n'
