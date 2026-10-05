# Dotfiles

Personal, XDG-oriented shell, editor, terminal, and coding-agent configuration managed with symlinks.

## Install

```sh
./install.sh
```

`install.sh` runs `bootstrap.sh`, which installs missing tools on macOS (Homebrew) or Debian and Ubuntu (apt), then links every non-ignored file under `home/` to the same path under `$HOME`. It is safe to rerun. Run `bootstrap.sh` alone to install tools without linking.

On a server without npm access, `./install.sh --minimal` installs only basic system tools and links the files. It skips Node, skill dependencies, Neovim, Tree-sitter, Starship, uv, and Ruff.

The bootstrap does not install a browser. The web-search skill needs Chrome, Brave, Edge, or Chromium, or `WEB_SEARCH_BROWSER_BIN`.

## Layout

| Path | Contents |
| --- | --- |
| `~/.zshenv` | Environment for every shell: XDG, `PATH`, `VAULT` |
| `~/.zprofile` | Login only: Homebrew, `PATH` order after macOS `path_helper`, `.zprofile.local` |
| `~/.zshrc` | Interactive shell: history, completion, aliases, tool integrations |
| `~/.config/` | bat, Ghostty, Herdr, Starship, Git, Neovim |
| `~/.pi/agent/` | Pi settings, extensions, and package manifests |
| `~/.agents/skills/` | Shared agent skills |
| `~/AGENTS.md` | Personal agent rules loaded in every directory under `$HOME` |

## Machine overrides

Defaults use `${NAME:-value}`, so values already set win. Put machine-specific environment and secrets in `~/.zprofile.local`, and interactive aliases and functions in `~/.zshrc.local`. Neither is tracked.

```sh
export VAULT="$HOME/vault/Val"
```

`.zprofile.local` loads only in login shells. Child shells inherit what it exports.

## Coding agents

`home/.pi/agent/` is the global [Pi](https://pi.dev/) configuration. The local extensions add `/clear`, `/goal`, `/vault`, `$NAME` path completion, `.agents/skills/` discovery up the directory tree (the deepest skill with a name wins, also over `~/.agents/skills/`), Herdr status updates, and `Ctrl+Shift+G` to edit the prompt in Neovim. Run `pi update --extensions` to update the packages listed in `settings.json`.

`home/.agents/skills/` holds the shared [Agent Skills](https://agentskills.io/). `home/.agents/.skill-lock.json` records upstream sources. Use `/skill:<name>` to load one explicitly.

The `codex` and `claude` aliases disable approval checks. Use them only where unrestricted agent access is fine.

## Shell

Plain Zsh, no framework. Emacs key bindings, with `Up` and `Down` filtering history by what is typed, and `Alt+←` and `Alt+→` moving by path segment.

[Deja](https://github.com/Giammarco-Ferranti/deja) adds history ghost text when `deja` is on `PATH`:

```sh
brew install Giammarco-Ferranti/deja/deja
deja import --file "$XDG_STATE_HOME/zsh/history"
```

`Tab` accepts the ghost on an empty prompt, when it continues the current word, or for a fuzzy match on the first word. Otherwise it runs native completion. Type a space before `Tab` to force completion. `→` accepts the whole ghost, `Ctrl+→` one word, and `Ctrl+N` cycles alternatives.

## Neovim

lazy.nvim with nvim-treesitter, snacks.nvim, mini.icons, and gitsigns, pinned in `lazy-lock.json`. Colors use terminal palette indexes 0 to 15, so they follow the Ghostty theme. Python files start `ruff server` when `ruff` is on `PATH`.

| Key | Action |
| --- | --- |
| `Space e` / `Cmd+B` | File tree (`H` hidden, `I` ignored) |
| `Space Space` | Find files |
| `Space /` | Search text |
| `Space ,` | Switch buffers |
| `Space f` | Format with Ruff |

## Add a dotfile

Put the file under `home/` at its path relative to `$HOME`, then run `./install.sh`. Prefer the XDG path under `.config/` when the app supports it.
