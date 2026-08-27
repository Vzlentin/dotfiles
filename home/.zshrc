# Interactive Zsh configuration.

# Interactive non-login shells do not read .zprofile, so provide the same XDG
# defaults here while leaving Zsh's startup files directly under $HOME.
export XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
export XDG_CACHE_HOME="${XDG_CACHE_HOME:-$HOME/.cache}"
export XDG_DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
export XDG_STATE_HOME="${XDG_STATE_HOME:-$HOME/.local/state}"
export SHELL_SESSIONS_DISABLE=1

# History and generated completion state
mkdir -p "$XDG_STATE_HOME/zsh" "$XDG_CACHE_HOME/zsh"
HISTFILE="$XDG_STATE_HOME/zsh/history"
HISTSIZE=10000
SAVEHIST=10000
setopt APPEND_HISTORY
setopt SHARE_HISTORY
setopt HIST_EXPIRE_DUPS_FIRST
setopt HIST_IGNORE_DUPS
setopt HIST_IGNORE_SPACE
setopt HIST_REDUCE_BLANKS

# Completion and key bindings
ZSH_COMPDUMP="${ZSH_COMPDUMP:-$XDG_CACHE_HOME/zsh/.zcompdump}"
mkdir -p "${ZSH_COMPDUMP:h}"
autoload -Uz compinit
compinit -d "$ZSH_COMPDUMP"
bindkey -e

# Portable colored output
case "$OSTYPE" in
    darwin*) alias ls='ls -G' ;;
    linux*)  alias ls='ls --color=auto' ;;
esac
alias grep='grep --color=auto'

# Commands
alias python='python3'
alias vim='nvim'
alias codex='codex --dangerously-bypass-approvals-and-sandbox'
alias claude='claude --dangerously-skip-permissions'

# Optional integrations
if (( $+commands[just] )); then
    eval "$(just --completions zsh)"
fi

if (( $+commands[direnv] )); then
    eval "$(direnv hook zsh)"
fi

if (( $+commands[starship] )); then
    export STARSHIP_CONFIG="$XDG_CONFIG_HOME/starship.toml"
    eval "$(starship init zsh)"
fi

# Machine-specific aliases, functions, and interactive settings belong here.
[[ -f "$HOME/.zshrc.local" ]] && source "$HOME/.zshrc.local"

# Keep one persistent tmux session for interactive SSH connections.
if [[ -z "$TMUX" && -n "$SSH_TTY" ]] && (( $+commands[tmux] )); then
    tmux new-session -A -s main
fi
