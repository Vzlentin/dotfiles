# Login-only setup; shared environment defaults live in .zshenv.

# Homebrew is not on the default PATH on Apple Silicon Macs.
if [[ -x /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
elif [[ -x /usr/local/bin/brew ]]; then
    eval "$(/usr/local/bin/brew shellenv)"
fi

# Machine-specific environment and secrets are loaded only by login shells.
if [[ -f "$HOME/.zprofile.local" ]]; then
    source "$HOME/.zprofile.local"
fi
