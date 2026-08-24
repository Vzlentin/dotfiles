# Login shell environment.

# XDG defaults are defined here instead of changing Zsh's startup directory.
export XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
export XDG_CACHE_HOME="${XDG_CACHE_HOME:-$HOME/.cache}"
export XDG_DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
export XDG_STATE_HOME="${XDG_STATE_HOME:-$HOME/.local/state}"
export SHELL_SESSIONS_DISABLE=1

# Homebrew is not on the default PATH on Apple Silicon Macs.
if [[ -x /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
elif [[ -x /usr/local/bin/brew ]]; then
    eval "$(/usr/local/bin/brew shellenv)"
fi

export EDITOR="nvim"
export VISUAL="$EDITOR"
export VAULT="$HOME/vault/Val"

# Keep tools that do not follow the XDG Base Directory specification out of
# $HOME. Each variable is the tool's supported location override.
export AZURE_CONFIG_DIR="$XDG_CONFIG_HOME/azure"
export DOCKER_CONFIG="$XDG_CONFIG_HOME/docker"
export IPYTHONDIR="$XDG_CONFIG_HOME/ipython"
export JUPYTER_CONFIG_DIR="$XDG_CONFIG_HOME/jupyter"
export JUPYTER_DATA_DIR="$XDG_DATA_HOME/jupyter"
export KUBECONFIG="$XDG_CONFIG_HOME/kube/config"
export MPLCONFIGDIR="$XDG_CACHE_HOME/matplotlib"
export NODE_REPL_HISTORY="$XDG_STATE_HOME/node/repl_history"
export NPM_CONFIG_CACHE="$XDG_CACHE_HOME/npm"
export NPM_CONFIG_USERCONFIG="$XDG_CONFIG_HOME/npm/npmrc"
export PYTHON_HISTORY="$XDG_STATE_HOME/python/history"

# Prevent Terraform from recreating its legacy checkpoint cache in ~/.terraform.d.
export CHECKPOINT_DISABLE=1

# Use a unique path array so repeated shell startup does not duplicate entries.
typeset -U path PATH
path=(
    "$HOME/.rd/bin"
    "$HOME/.druk/bin"
    "/opt/homebrew/share/google-cloud-sdk/bin"
    "$HOME/.local/bin"
    $path
)

# Machine-specific environment and secrets belong here.
[[ -f "$HOME/.zprofile.local" ]] && source "$HOME/.zprofile.local"
