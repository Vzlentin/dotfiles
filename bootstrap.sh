#!/bin/sh
set -eu

run_as_root() {
    if [ "$(id -u)" -eq 0 ]; then
        "$@"
    else
        sudo "$@"
    fi
}

install_debian_tools() {
    set --
    command -v chromium >/dev/null 2>&1 || set -- "$@" chromium
    command -v git >/dev/null 2>&1 || set -- "$@" git
    command -v jq >/dev/null 2>&1 || set -- "$@" jq
    command -v nvim >/dev/null 2>&1 || set -- "$@" neovim
    command -v npm >/dev/null 2>&1 || set -- "$@" npm
    command -v tree-sitter >/dev/null 2>&1 || set -- "$@" tree-sitter-cli
    command -v unzip >/dev/null 2>&1 || set -- "$@" unzip
    command -v zsh >/dev/null 2>&1 || set -- "$@" zsh

    if [ "$#" -gt 0 ]; then
        run_as_root apt-get update
        run_as_root apt-get install -y "$@"
    fi
}

install_macos_tools() {
    set --
    command -v git >/dev/null 2>&1 || set -- "$@" git
    command -v jq >/dev/null 2>&1 || set -- "$@" jq
    command -v nvim >/dev/null 2>&1 || set -- "$@" neovim
    command -v npm >/dev/null 2>&1 || set -- "$@" node
    command -v tree-sitter >/dev/null 2>&1 || set -- "$@" tree-sitter
    command -v zsh >/dev/null 2>&1 || set -- "$@" zsh

    chrome_missing=0
    if [ ! -d '/Applications/Google Chrome.app' ] && \
        [ ! -d "$HOME/Applications/Google Chrome.app" ]; then
        chrome_missing=1
    fi

    if [ "$#" -eq 0 ] && [ "$chrome_missing" -eq 0 ]; then
        return
    fi

    if ! command -v brew >/dev/null 2>&1; then
        printf 'Homebrew is required on macOS: https://brew.sh\n' >&2
        exit 1
    fi

    if [ "$#" -gt 0 ]; then
        brew install "$@"
    fi
    if [ "$chrome_missing" -eq 1 ]; then
        brew install --cask google-chrome
    fi
}

case "$(uname -s)" in
    Darwin)
        install_macos_tools
        ;;
    Linux)
        if [ ! -r /etc/os-release ]; then
            printf 'Cannot identify this Linux distribution.\n' >&2
            exit 1
        fi

        . /etc/os-release
        if [ "${ID:-}" != debian ]; then
            printf 'Unsupported Linux distribution: %s\n' "${ID:-unknown}" >&2
            exit 1
        fi
        install_debian_tools
        ;;
    *)
        printf 'Unsupported operating system: %s\n' "$(uname -s)" >&2
        exit 1
        ;;
esac

BUN_INSTALL=${BUN_INSTALL:-"${XDG_DATA_HOME:-$HOME/.local/share}/bun"}
starship_missing=0
bun_missing=0

if ! command -v starship >/dev/null 2>&1 && \
    [ ! -x "$HOME/.local/bin/starship" ]; then
    starship_missing=1
fi
if ! command -v bun >/dev/null 2>&1 && \
    [ ! -x "$BUN_INSTALL/bin/bun" ]; then
    bun_missing=1
fi

if [ "$starship_missing" -eq 1 ] || [ "$bun_missing" -eq 1 ]; then
    if ! command -v curl >/dev/null 2>&1; then
        printf 'curl is required but was not found.\n' >&2
        exit 1
    fi

    TEMP_DIR=$(mktemp -d)
    trap 'rm -rf "$TEMP_DIR"' EXIT HUP INT TERM
fi

if [ "$starship_missing" -eq 1 ]; then
    mkdir -p "$HOME/.local/bin"
    curl -fsSL https://starship.rs/install.sh -o "$TEMP_DIR/install-starship.sh"
    sh "$TEMP_DIR/install-starship.sh" --yes --bin-dir "$HOME/.local/bin"
fi

if [ "$bun_missing" -eq 1 ]; then
    export BUN_INSTALL
    curl -fsSL https://bun.com/install -o "$TEMP_DIR/install-bun.sh"
    SHELL=/bin/sh bash "$TEMP_DIR/install-bun.sh"
fi

printf 'Tools are ready.\n'
