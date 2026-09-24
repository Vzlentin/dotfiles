# Environment for every zsh.

export XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
export XDG_CACHE_HOME="${XDG_CACHE_HOME:-$HOME/.cache}"
export XDG_DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
export XDG_STATE_HOME="${XDG_STATE_HOME:-$HOME/.local/state}"
export SHELL_SESSIONS_DISABLE=1

export EDITOR="nvim"
export VISUAL="$EDITOR"
export VAULT="${VAULT:-$HOME/vault}"
export BUN_INSTALL="${BUN_INSTALL:-$XDG_DATA_HOME/bun}"

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
export CHECKPOINT_DISABLE=1

[[ -f "$HOME/.cargo/env" ]] && . "$HOME/.cargo/env"

typeset -U path PATH
path=(
    "$BUN_INSTALL/bin"
    "$HOME/.rd/bin"
    "$HOME/.druk/bin"
    "/opt/homebrew/share/google-cloud-sdk/bin"
    "$HOME/.local/bin"
    $path
)
