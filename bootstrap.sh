#!/bin/sh
set -eu
export PATH="$HOME/.local/bin:$PATH"
# Show downloads and lifecycle scripts instead of an unexplained npm spinner.
export npm_config_progress=false npm_config_foreground_scripts=true
export npm_config_loglevel=info npm_config_audit=false npm_config_fund=false

minimal=0
case "$*" in
    '') ;;
    --minimal) minimal=1 ;;
    *) printf 'Usage: %s [--minimal]\n' "$0" >&2; exit 2 ;;
esac

run_as_root() {
    if [ "$(id -u)" -eq 0 ]; then
        "$@"
    else
        sudo "$@"
    fi
}

install_debian_tools() {
    set --
    { command -v bat || command -v batcat; } >/dev/null 2>&1 || set -- "$@" bat
    command -v curl >/dev/null 2>&1 || set -- "$@" curl
    if [ "$(dpkg-query -W -f='${Status}' ca-certificates 2>/dev/null || true)" != 'install ok installed' ]; then
        set -- "$@" ca-certificates
    fi
    command -v xz >/dev/null 2>&1 || set -- "$@" xz-utils
    command -v git >/dev/null 2>&1 || set -- "$@" git
    command -v jq >/dev/null 2>&1 || set -- "$@" jq
    # The full mode installs the latest Neovim release instead of the older apt
    # package. Tree-sitter needs a C compiler to build parsers.
    if [ "$minimal" -eq 1 ]; then
        command -v nvim >/dev/null 2>&1 || set -- "$@" neovim
    else
        command -v cc >/dev/null 2>&1 || set -- "$@" gcc libc6-dev
    fi
    command -v rg >/dev/null 2>&1 || set -- "$@" ripgrep
    command -v unzip >/dev/null 2>&1 || set -- "$@" unzip
    command -v zsh >/dev/null 2>&1 || set -- "$@" zsh

    if [ "$#" -gt 0 ]; then
        run_as_root apt-get update
        run_as_root apt-get install -y "$@"
    fi

    # Debian names the bat command batcat because another package owns bat.
    if ! command -v bat >/dev/null 2>&1 && command -v batcat >/dev/null 2>&1; then
        mkdir -p "$HOME/.local/bin"
        ln -sf "$(command -v batcat)" "$HOME/.local/bin/bat"
    fi

    # Minimal mode uses only distro packages and leaves existing tools alone.
    if [ "$minimal" -eq 1 ]; then
        return
    fi

    install_node

    if ! command -v nvim >/dev/null 2>&1 && \
        [ ! -x "$HOME/.local/bin/nvim" ]; then
        install_neovim
    fi

    if ! command -v tree-sitter >/dev/null 2>&1 && \
        [ ! -x "$HOME/.local/bin/tree-sitter" ]; then
        install_tree_sitter
    fi
}

install_tree_sitter() {
    case "$(uname -m)" in
        x86_64) tree_sitter_arch=x64 ;;
        aarch64|arm64) tree_sitter_arch=arm64 ;;
        *) printf 'Unsupported Tree-sitter architecture: %s\n' "$(uname -m)" >&2; exit 1 ;;
    esac
    printf '\n==> Downloading Tree-sitter CLI from GitHub\n'
    TEMP_DIR=$(mktemp -d)
    trap 'rm -rf "$TEMP_DIR"' EXIT HUP INT TERM
    curl --fail --location --show-error --retry 3 --connect-timeout 15 --max-time 300 \
        "https://github.com/tree-sitter/tree-sitter/releases/latest/download/tree-sitter-linux-$tree_sitter_arch.gz" \
        -o "$TEMP_DIR/tree-sitter.gz"
    gzip -dc "$TEMP_DIR/tree-sitter.gz" > "$TEMP_DIR/tree-sitter"
    chmod 755 "$TEMP_DIR/tree-sitter"
    # The release binary needs a newer glibc than some distributions have, such as Debian 12.
    if ! "$TEMP_DIR/tree-sitter" --version; then
        cargo_bin="${CARGO_HOME:-$HOME/.cargo}/bin"
        if [ ! -x "$cargo_bin/cargo" ]; then
            printf '\n==> Installing Rust\n'
            curl -fsSL https://sh.rustup.rs -o "$TEMP_DIR/rustup-init.sh"
            # ~/.zshenv links into this checkout and already loads ~/.cargo/env.
            sh "$TEMP_DIR/rustup-init.sh" -y --profile minimal --no-modify-path
        fi
        printf '\n==> Building Tree-sitter CLI with Cargo\n'
        "$cargo_bin/cargo" install --locked --root "$TEMP_DIR/cargo" tree-sitter-cli
        mv -f "$TEMP_DIR/cargo/bin/tree-sitter" "$TEMP_DIR/tree-sitter"
        "$TEMP_DIR/tree-sitter" --version
    fi
    mkdir -p "$HOME/.local/bin"
    mv -f "$TEMP_DIR/tree-sitter" "$HOME/.local/bin/tree-sitter"
    rm -rf "$TEMP_DIR"
}

install_neovim() {
    case "$(uname -m)" in
        x86_64) neovim_arch=x86_64 ;;
        aarch64|arm64) neovim_arch=arm64 ;;
        *) printf 'Unsupported Neovim architecture: %s\n' "$(uname -m)" >&2; exit 1 ;;
    esac
    printf '\n==> Downloading Neovim from GitHub\n'
    TEMP_DIR=$(mktemp -d)
    trap 'rm -rf "$TEMP_DIR"' EXIT HUP INT TERM
    curl --fail --location --show-error --retry 3 --connect-timeout 15 --max-time 300 \
        "https://github.com/neovim/neovim/releases/latest/download/nvim-linux-$neovim_arch.tar.gz" \
        -o "$TEMP_DIR/nvim.tar.gz"
    mkdir -p "$TEMP_DIR/neovim"
    tar -xzf "$TEMP_DIR/nvim.tar.gz" -C "$TEMP_DIR/neovim" --strip-components=1
    "$TEMP_DIR/neovim/bin/nvim" --version
    # Not $XDG_DATA_HOME/nvim, which is Neovim's own data directory.
    neovim_home="${XDG_DATA_HOME:-$HOME/.local/share}/neovim"
    rm -rf "$neovim_home"
    mkdir -p "$(dirname "$neovim_home")" "$HOME/.local/bin"
    mv "$TEMP_DIR/neovim" "$neovim_home"
    ln -sf "$neovim_home/bin/nvim" "$HOME/.local/bin/nvim"
    rm -rf "$TEMP_DIR"
}

install_node() {
    if command -v npm >/dev/null 2>&1 && command -v node >/dev/null 2>&1 && \
        node -e 'const [m, n] = process.versions.node.split(".").map(Number); process.exit(m > 22 || (m === 22 && n >= 19) ? 0 : 1)'; then
        return
    fi

    case "$(dpkg --print-architecture)" in
        amd64) node_arch=x64 ;;
        arm64) node_arch=arm64 ;;
        *) printf 'Unsupported Node architecture.\n' >&2; exit 1 ;;
    esac
    printf '\n==> Downloading Node 22\n'
    TEMP_DIR=$(mktemp -d)
    trap 'rm -rf "$TEMP_DIR"' EXIT HUP INT TERM
    node_url=https://nodejs.org/dist/latest-v22.x
    curl -fsSL "$node_url/SHASUMS256.txt" -o "$TEMP_DIR/SHASUMS256.txt"
    node_archive=$(awk -v arch="$node_arch" '$2 ~ ("-linux-" arch "\\.tar\\.xz$") { print $2 }' "$TEMP_DIR/SHASUMS256.txt")
    if [ -z "$node_archive" ]; then
        printf 'Cannot find the Node 22 download.\n' >&2
        exit 1
    fi
    curl -fsSL "$node_url/$node_archive" -o "$TEMP_DIR/$node_archive"
    (cd "$TEMP_DIR" && grep "  $node_archive\$" SHASUMS256.txt | sha256sum -c -)
    node_home="${XDG_DATA_HOME:-$HOME/.local/share}/node"
    mkdir -p "$node_home" "$HOME/.local/bin"
    tar -xJf "$TEMP_DIR/$node_archive" -C "$node_home" --strip-components=1
    for tool in node npm npx; do
        ln -sf "$node_home/bin/$tool" "$HOME/.local/bin/$tool"
    done
    export PATH="$HOME/.local/bin:$PATH"
    rm -rf "$TEMP_DIR"
}

install_macos_tools() {
    set --
    command -v bat >/dev/null 2>&1 || set -- "$@" bat
    command -v git >/dev/null 2>&1 || set -- "$@" git
    command -v jq >/dev/null 2>&1 || set -- "$@" jq
    command -v nvim >/dev/null 2>&1 || set -- "$@" neovim
    command -v rg >/dev/null 2>&1 || set -- "$@" ripgrep
    if [ "$minimal" -eq 0 ]; then
        command -v npm >/dev/null 2>&1 || set -- "$@" node
        command -v tree-sitter >/dev/null 2>&1 || set -- "$@" tree-sitter
        command -v uv >/dev/null 2>&1 || set -- "$@" uv
    fi
    command -v zsh >/dev/null 2>&1 || set -- "$@" zsh

    if [ "$#" -eq 0 ]; then
        return
    fi

    if ! command -v brew >/dev/null 2>&1; then
        printf 'Homebrew is required on macOS: https://brew.sh\n' >&2
        exit 1
    fi

    brew install "$@"
}

printf '\n==> Installing system tools\n'
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
        if [ "${ID:-}" != debian ] && [ "${ID:-}" != ubuntu ]; then
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

if [ "$minimal" -eq 1 ]; then
    printf '\n==> Minimal tools ready; skipping runtime and skill downloads\n'
    exit 0
fi

# Install each skill once, without scanning generated dependencies or checkouts.
script_dir=$(CDPATH= cd "$(dirname "$0")" && pwd)
if [ -d "$script_dir/home/.agents" ]; then
    find "$script_dir/home/.agents" \( -name node_modules -o -name .git \) -prune -o \
        -name package-lock.json -type f -print | while IFS= read -r lockfile; do
        package_dir=$(dirname "$lockfile")
        if [ -f "$package_dir/package.json" ]; then
            # npm writes this record last, so an interrupted install leaves none.
            installed="$package_dir/node_modules/.package-lock.json"
            if [ "$installed" -nt "$lockfile" ] && [ "$installed" -nt "$package_dir/package.json" ]; then
                continue
            fi
            printf '\n==> Installing dependencies: %s\n' "$package_dir"
            npm ci --prefix "$package_dir"
        fi
    done
fi

starship_missing=0
uv_missing=0

if ! command -v starship >/dev/null 2>&1 && \
    [ ! -x "$HOME/.local/bin/starship" ]; then
    starship_missing=1
fi

if ! command -v uv >/dev/null 2>&1 && \
    [ ! -x "$HOME/.local/bin/uv" ]; then
    uv_missing=1
fi

if [ "$starship_missing" -eq 1 ] || [ "$uv_missing" -eq 1 ]; then
    if ! command -v curl >/dev/null 2>&1; then
        printf 'curl is required but was not found.\n' >&2
        exit 1
    fi

    TEMP_DIR=$(mktemp -d)
    trap 'rm -rf "$TEMP_DIR"' EXIT HUP INT TERM
fi

if [ "$starship_missing" -eq 1 ]; then
    printf '\n==> Installing Starship\n'
    mkdir -p "$HOME/.local/bin"
    curl -fsSL https://starship.rs/install.sh -o "$TEMP_DIR/install-starship.sh"
    sh "$TEMP_DIR/install-starship.sh" --yes --bin-dir "$HOME/.local/bin"
fi

if [ "$uv_missing" -eq 1 ]; then
    printf '\n==> Installing uv\n'
    curl -fsSL https://astral.sh/uv/install.sh -o "$TEMP_DIR/install-uv.sh"
    UV_INSTALL_DIR="$HOME/.local/bin" UV_NO_MODIFY_PATH=1 sh "$TEMP_DIR/install-uv.sh"
fi

if ! command -v ruff >/dev/null 2>&1; then
    printf '\n==> Installing Ruff\n'
    UV_TOOL_BIN_DIR="$HOME/.local/bin" uv tool install ruff
fi

if ! command -v workflows >/dev/null 2>&1 && [ -f "$HOME/Dev/perso/workflows/pyproject.toml" ]; then
    printf '\n==> Installing workflows\n'
    UV_TOOL_BIN_DIR="$HOME/.local/bin" uv tool install --editable "$HOME/Dev/perso/workflows"
fi

printf 'Tools are ready.\n'
