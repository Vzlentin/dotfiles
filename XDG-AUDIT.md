# XDG migration audit

This records which legacy entries in `$HOME` were reviewed. The goal is to move
configuration only when the application has a supported override; application
install roots and OS-owned paths should not be forced into XDG directories.

## Migrated

| Legacy path | New path | Mechanism |
| --- | --- | --- |
| `~/.zsh_history` | `$XDG_STATE_HOME/zsh/history` | `HISTFILE` |
| `~/.zcompdump*` | `$XDG_CACHE_HOME/zsh/.zcompdump` | `ZSH_COMPDUMP` and `compinit -d` |
| `~/.gitconfig` | `$XDG_CONFIG_HOME/git/config` | Installer-managed compatibility link that prevents a legacy file from overriding the XDG config |
| `~/.azure` | `$XDG_CONFIG_HOME/azure` | `AZURE_CONFIG_DIR` |
| `~/.docker` | `$XDG_CONFIG_HOME/docker` | `DOCKER_CONFIG` |
| `~/.ipython` | `$XDG_CONFIG_HOME/ipython` | `IPYTHONDIR` |
| `~/.jupyter` | `$XDG_CONFIG_HOME/jupyter` | `JUPYTER_CONFIG_DIR` |
| `~/.kube/config` | `$XDG_CONFIG_HOME/kube/config` | `KUBECONFIG` |
| `~/.matplotlib` | `$XDG_CACHE_HOME/matplotlib` | `MPLCONFIGDIR` (the existing files were generated font caches) |
| `~/.npm` | `$XDG_CACHE_HOME/npm` | `NPM_CONFIG_CACHE` |
| `~/.npmrc` | `$XDG_CONFIG_HOME/npm/npmrc` | `NPM_CONFIG_USERCONFIG` |
| `~/.node_repl_history` | `$XDG_STATE_HOME/node/repl_history` | `NODE_REPL_HISTORY` |
| `~/.python_history` | `$XDG_STATE_HOME/python/history` | `PYTHON_HISTORY` |
| `~/.vimrc` | `$XDG_CONFIG_HOME/vim/vimrc` | Installer-managed compatibility link for Vim builds without native XDG lookup |
| `~/.viminfo` | `$XDG_STATE_HOME/vim/viminfo` | XDG Vim config sets the `viminfofile` option |
| `~/.terraform.d` checkpoint files | disabled | `CHECKPOINT_DISABLE=1`; the directory held generated checkpoint cache only |

macOS Terminal's private Zsh session persistence is disabled to avoid
`~/.zsh_sessions`; shared Zsh history remains enabled.

## Already XDG-aware

`gh`, `gcloud`, `druk`, `fish`, `herdr`, `nvim`, `starship`, and `uv` already
store their configuration/data/cache below `.config`, `.local`, and `.cache`.

## Reviewed and intentionally left in `$HOME`

| Path | Reason |
| --- | --- |
| `~/.zprofile`, `~/.zshrc` | Zsh startup files are intentionally kept at their standard `$HOME` paths; no `.zshenv` or `ZDOTDIR` bootstrap is used. |
| `~/.tmux.conf` | Existing tmux and TPM configuration uses this standard path for startup and reloads. |
| `~/.agents` | Shared agent skills use this cross-tool convention; no stable override is available. |
| `~/.cua-driver` | Package/install root, not configuration; no stable location override found. |
| `~/.cursor` | Cursor CLI state and plugins; no supported global home override found. |
| `~/.druk/bin`, `~/.rd/bin` | Tool-managed executable roots, not configuration. Druk's actual config is already XDG-based. |
| `~/.homebrew` | Homebrew-managed trust state. |
| `~/.kuberlr` | Rancher Desktop's managed kubectl download cache; its wrapper chooses this path. |
| `~/.ssh` | OpenSSH's standard security-sensitive location. |
| `~/.Trash` | macOS-owned directory. |
| `~/.vscode`, `~/.vscode-shared` | VS Code extension/shared runtime storage, not user configuration. |
| `~/.cshrc`, `~/.tcshrc` | Rancher Desktop-managed shell integration. |
| `~/.CFUserTextEncoding` | macOS-owned locale state. |

## Deferred until no agent process is using them

| Path | Supported override | Why deferred |
| --- | --- | --- |
| `~/.codex` | `CODEX_HOME` | The Codex executable and a running Computer Use service currently resolve files through this tree. |
| `~/.pi/agent` | `PI_CODING_AGENT_DIR`, `PI_CODING_AGENT_SESSION_DIR` | The active Pi session is writing its session file here. Pi's config and session state should be split during migration. |

These two migrations should be done from a plain terminal after all Codex and Pi
processes have exited, then smoke-tested before deleting their old directories.
