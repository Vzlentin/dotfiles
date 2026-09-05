# Interactive Zsh configuration.

# Interactive non-login shells do not read .zprofile, so provide the same XDG
# defaults here while leaving Zsh's startup files directly under $HOME.
export XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
export XDG_CACHE_HOME="${XDG_CACHE_HOME:-$HOME/.cache}"
export XDG_DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
export XDG_STATE_HOME="${XDG_STATE_HOME:-$HOME/.local/state}"
export SHELL_SESSIONS_DISABLE=1

# History
mkdir -p "$XDG_STATE_HOME/zsh" "$XDG_CACHE_HOME/zsh"
HISTFILE="$XDG_STATE_HOME/zsh/history"
HISTSIZE=100000
SAVEHIST=100000
setopt SHARE_HISTORY          # write on each command, read from other shells
setopt EXTENDED_HISTORY       # timestamp + duration per entry
setopt HIST_EXPIRE_DUPS_FIRST
setopt HIST_IGNORE_ALL_DUPS   # re-running a command drops its older copies
setopt HIST_SAVE_NO_DUPS
setopt HIST_IGNORE_SPACE      # leading space keeps a line out of history (and deja)
setopt HIST_REDUCE_BLANKS
setopt HIST_VERIFY            # `!!` expands onto the line instead of running

# Shell behaviour
setopt AUTO_CD                # `..` or `~/Dev` alone changes directory
setopt AUTO_PUSHD             # cd keeps a stack; `cd -<Tab>` lists it
setopt PUSHD_IGNORE_DUPS
setopt PUSHD_SILENT
setopt EXTENDED_GLOB          # `^*.md`, `**/`, `(#i)case-insensitive`
setopt INTERACTIVE_COMMENTS   # `# comment` at the prompt
setopt NO_BEEP
# setopt NO_CLOBBER           # `>` refuses to overwrite; `>|` forces
# setopt CORRECT              # "did you mean" for the command word only

# Completion
ZSH_COMPDUMP="${ZSH_COMPDUMP:-$XDG_CACHE_HOME/zsh/.zcompdump}"
mkdir -p "${ZSH_COMPDUMP:h}"
autoload -Uz compinit
compinit -d "$ZSH_COMPDUMP"
zmodload zsh/complist
zstyle ':completion:*' menu select                          # arrow-key menu
zstyle ':completion:*' matcher-list 'm:{a-zA-Z}={A-Za-z}'  # case-insensitive
zstyle ':completion:*' list-colors ''                       # default colours
zstyle ':completion:*' group-name ''
zstyle ':completion:*:descriptions' format '%F{yellow}-- %d --%f'
zstyle ':completion:*:warnings' format '%F{red}-- no matches --%f'
zstyle ':completion:*' use-cache on
zstyle ':completion:*' cache-path "$XDG_CACHE_HOME/zsh/zcompcache"
zstyle ':completion:*:*:*:*:*' ignored-patterns '.DS_Store' '__pycache__'

# Key bindings (emacs mode; sequences are xterm-style, as Ghostty sends them)
bindkey -e
WORDCHARS=${WORDCHARS//[\/=.-]}   # word motion stops at / = . - so ^W kills one path segment

autoload -Uz up-line-or-beginning-search down-line-or-beginning-search
zle -N up-line-or-beginning-search
zle -N down-line-or-beginning-search
bindkey '^[[A' up-line-or-beginning-search      # Up: history filtered by what is typed
bindkey '^[[B' down-line-or-beginning-search    # Down
bindkey '^[[H' beginning-of-line                # Home
bindkey '^[[F' end-of-line                      # End
bindkey '^[[3~' delete-char                     # Delete
bindkey '^[[1;3C' forward-word                  # Alt+Right
bindkey '^[[1;3D' backward-word                 # Alt+Left
bindkey '^[[1;5C' forward-word                  # Ctrl+Right (deja: accept one ghost word)
bindkey '^[[1;5D' backward-word                 # Ctrl+Left
bindkey '^[[Z' reverse-menu-complete            # Shift+Tab: back in completion menu

# Edit the current line in $EDITOR. Off by default because deja owns ^X;
# to enable, also export DEJA_TOGGLE_KEY='^[x' above the deja block.
# autoload -Uz edit-command-line && zle -N edit-command-line
# bindkey '^X^E' edit-command-line

# Portable colored output
case "$OSTYPE" in
    darwin*) alias ls='ls -G' ;;
    linux*)  alias ls='ls --color=auto' ;;
esac
alias grep='grep --color=auto'

# Listing
alias ll='ls -l'
alias la='ls -la'

# Navigation
alias ...='cd ../..'
alias ....='cd ../../..'

# Git
alias g='git'
alias gs='git status'
alias ga='git add'
alias gc='git commit -m'
alias gd='git diff'
alias gl='git log --oneline --graph --decorate'
alias gp='git push'
alias gco='git checkout'

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

# Deja: predictive inline autosuggestions. Right arrow accepts the ghost,
# Ctrl+N cycles alternatives (moved off Tab, which deja would otherwise
# swallow whenever a ghost is showing).
if (( $+commands[deja] )); then
    export DEJA_CYCLE_KEY='^N'
    if [[ -r "$XDG_DATA_HOME/deja/init.zsh" ]]; then
        source "$XDG_DATA_HOME/deja/init.zsh"
    else
        eval "$(deja init zsh)"
    fi

    # Tab accepts the ghost when it continues what is being typed:
    #   - empty prompt: the predicted next command
    #   - prefix ghost (grey text continues the current word): accept
    #   - fuzzy ghost (" > cmd"): accept only while on the first word
    # Native zsh completion when there is no ghost, after a trailing space
    # (`git checkout <Tab>` lists branches even if a ghost is showing), or for
    # a fuzzy ghost past the first word.
    _deja_or_complete() {
        local word="${LBUFFER##*[[:space:]]}"
        if (( $#POSTDISPLAY && CURSOR == $#BUFFER )); then
            if [[ -z "$BUFFER" ]]; then
                zle deja-accept; return
            elif [[ -n "$word" && "$_DEJA_SUGGESTION_MODE" == prefix ]]; then
                zle deja-accept; return
            elif [[ -n "$word" && "$LBUFFER" != *[[:space:]]* ]]; then
                zle deja-accept; return
            fi
        fi
        zle expand-or-complete
    }
    zle -N _deja_or_complete
    bindkey '^I' _deja_or_complete
fi

# Machine-specific aliases, functions, and interactive settings belong here.
[[ -f "$HOME/.zshrc.local" ]] && source "$HOME/.zshrc.local"

# Keep one persistent tmux session for interactive SSH connections.
if [[ -z "$TMUX" && -n "$SSH_TTY" ]] && (( $+commands[tmux] )); then
    tmux new-session -A -s main
fi
