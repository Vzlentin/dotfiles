# Dotfiles

Personal, XDG-oriented shell, editor, terminal, and coding-agent configuration managed with symlinks.

## Layout

| File | Responsibility |
| --- | --- |
| `~/.zshenv` | Environment: XDG, `PATH`, `VAULT`, tool overrides |
| `~/.zprofile` | Login-only Homebrew initialization, `PATH` order repair, and machine-local environment |
| `~/.zshrc` | Interactive history, completion, aliases, and tool integrations |
| `~/.zprofile.local` | Machine-specific environment and secrets, not tracked |
| `~/.zshrc.local` | Machine-specific interactive settings, not tracked |
| `~/.config/bat/config` | Plain `bat` output, so mouse selections copy only the file text |
| `~/.config/ghostty/config` | Makes macOS Option send Alt key sequences for shell and TUI word editing |
| `~/.config/herdr/config.toml` | Defines Herdr navigation keys and custom popup, notification, and pane commands |
| `~/.config/starship.toml` | Starship prompt layout and styling |
| `~/.config/git/config` | Global Git identity, portable GitHub credential helper, and pull, push, fetch, merge, and diff defaults |
| `~/.config/nvim/` | Small Neovim configuration on lazy.nvim that follows the terminal palette; see [Neovim](#neovim) |
| `~/.pi/agent/` | Portable Pi settings, extensions, and package manifests |
| `~/.agents/` | Shared agent skills and their lockfiles |
| `bootstrap.sh` | Installs macOS, Debian, or Ubuntu tools, Node, Neovim, Starship, uv, and Ruff |
| `install.sh` | Runs `bootstrap.sh`, then links dotfiles |

Zsh startup files stay under `$HOME` (no `ZDOTDIR`). Shared environment defaults
live in `.zshenv` so they apply to login, interactive, and script shells.
Homebrew initialization and `.zprofile.local` stay login-only in `.zprofile`.
On macOS, `/etc/zprofile` runs `path_helper`, which moves system directories
before the `.zshenv` entries. `.zprofile` then puts the `.zshenv` entries
(`user_path`) first again, so login and non-login shells find the same tools.
History goes to `$XDG_STATE_HOME/zsh/history`; completion dump to
`$XDG_CACHE_HOME/zsh/.zcompdump`.

```text
Every zsh:               ~/.zshenv
Login zsh:               ~/.zshenv → ~/.zprofile
Interactive zsh:         ~/.zshenv → ~/.zshrc
Interactive login zsh:   ~/.zshenv → ~/.zprofile → ~/.zshrc
```

## Install

```sh
git clone <repository-url> ~/Dev/perso/dotfiles
cd ~/Dev/perso/dotfiles
```

Install the required tools and link the files:

```sh
./install.sh
```

For a server that cannot access npm, use:

```sh
./install.sh --minimal
```

This installs basic system tools through apt (Homebrew on macOS) and links the
dotfiles. It skips Node, shared-skill dependencies, and the
Neovim, Tree-sitter, Starship, uv, and Ruff installers. Existing tools, including a
Cargo-installed Tree-sitter, are left alone. It does not uninstall anything or
change certificate settings. Agent configuration is still linked, but its
dependencies are not provisioned. This mode still needs access to apt or
Homebrew when basic tools are missing.

The installer first runs `bootstrap.sh`. The bootstrap supports macOS and
Debian or Ubuntu and skips tools that are already available.

On macOS, it uses Homebrew for missing command-line tools, including Node,
Tree-sitter, and uv. Homebrew must already be installed if a package is
missing, and `curl` must already be available.

On Debian and Ubuntu, it uses `sudo apt-get` for missing command-line tools,
including `curl` and a C compiler. It downloads the latest official Tree-sitter
Linux release from GitHub into `~/.local/bin` (x64 and arm64). If that binary
cannot run, for example on Debian 12, it builds the latest Tree-sitter CLI with
Cargo instead. When Cargo is missing, it first installs Rust with rustup into
`~/.cargo`. Pi needs Node 22.19 or newer,
which the distribution packages may not provide. If Node or npm is missing, or
Node is older than 22.19, it installs the latest Node 22 release from nodejs.org
under `$XDG_DATA_HOME/node` (default `~/.local/share/node`), verifies its
published SHA-256 checksum, and links `node`, `npm`, and `npx` into
`~/.local/bin`. System Node packages are not removed.

If `nvim` is missing, the bootstrap installs the latest official Neovim release
from GitHub under `$XDG_DATA_HOME/neovim` (default `~/.local/share/neovim`) and
links `nvim` into `~/.local/bin`. It does not change an existing `nvim`.

On every platform, the bootstrap uses the official installers for missing
Starship and uv, then installs a missing Ruff with `uv tool install ruff` into
`~/.local/bin`. You can also run `bootstrap.sh` by itself to provision tools and
shared-skill dependencies without linking the dotfiles.

Shared-skill dependencies are installed with `npm ci` beside their source files.
A rerun skips a skill whose dependencies were installed after its `package.json`
and lockfile last changed. An interrupted install is always redone, because npm
records a finished install only at the end.

The bootstrap does not install a browser. The web-search skill uses an existing
Chrome, Brave, Edge, or Chromium from `PATH` or, on macOS, from
`/Applications`. On a machine without one, install a browser yourself or point
`WEB_SEARCH_BROWSER_BIN` at one.

The installer prints each step before it starts. npm prints request and lifecycle
script output instead of a spinner. To keep a log while preserving the
installer's exit status:

```sh
bash -o pipefail -c './install.sh 2>&1 | tee "$HOME/dotfiles-install.log"'
```

Do not run two installations at the same time. Stop an earlier run with Ctrl+C
and wait for it to exit before restarting.

### Linked files

After bootstrapping, the installer links each file under `home/` that Git
tracks, or that is new and not ignored, to its corresponding home path.
Git-ignored files, such as `node_modules` and other package managers' lockfiles,
are never linked. Because files are linked one by one, Pi writes credentials,
sessions, and other runtime state into real directories under `~/.pi`, not into
this checkout. The `.config`, `.cache`, `.local/share`, and `.local/state`
prefixes respect custom XDG base-directory environment variables. Existing files
are replaced. You can run the installer again safely; it prints only the links
it creates, replaces, or removes. Before linking, it removes links into this
checkout whose source was deleted, renamed, or is now ignored. It searches the
top level of `$HOME` and each directory that `home/` links into, such as
`~/.config` and `~/.pi`. It does not change other links, and it leaves
directories in place.

## Coding agents

This repository configures [Pi](https://pi.dev/) and provides shared
[Agent Skills](https://agentskills.io/) for Pi and other compatible coding
agents.

### Pi

The tracked files under `home/.pi/agent/` become the global Pi configuration at
`~/.pi/agent/`:

| Path | Purpose |
| --- | --- |
| `settings.json` | Selects the default model, `xhigh` thinking level, dark fullscreen UI, Neovim editor, and Pi packages |
| `models.json` | Registers a local MLX OpenAI-compatible model endpoint |
| `keybindings.json` | Holds global Pi key overrides |
| `extensions/` | Adds local commands, completion, skill discovery, and Herdr integration |
| `npm/package.json` and lockfile | Pin the npm packages declared in `settings.json` |
| `pi-codex-subagents/SYSTEM.md` | Gives spawned Codex subagents a small, scoped system prompt |

The custom extensions provide these behaviors:

- `/clear` starts a new session.
- `/goal` sets, edits, pauses, resumes, or clears a long-running task goal.
  The agent can read and update it with the `get_goal`, `create_goal`, and
  `update_goal` tools.
- `$NAME` and `$NAME/path` autocomplete environment variables and paths in the
  Pi editor.
- Trusted `.agents/skills/` directories are discovered from the current
  directory up to the filesystem root. The nearest skill wins on a name
  collision.
- Herdr receives Pi session and working-state updates when Pi runs in a Herdr
  pane.
- `Ctrl+Shift+G` opens the current prompt in Neovim in a temporary Herdr side pane,
  then copies the edited text back into Pi.
- `/vault` uses a routing model to suggest an Obsidian note under `$VAULT`, lets
  the user confirm or edit the path, and appends the last assistant reply.

Pi loads the npm and GitHub packages listed in `settings.json`, managing its
own checkouts independently of development repository paths. Run
`pi update --extensions` to update them. The configured npm command includes
development dependencies because `pi-autoresearch` currently needs them at
runtime; remove that override when its packaging is fixed. Package checkouts, generated dependencies, credentials, trust decisions,
sessions, and history are machine-local and excluded from Git.

### Shared skills

`home/.agents/skills/` is the shared skill source. It includes workflows for
architecture and domain modeling, GitHub and review work, GCP, Obsidian, web
research, visual explanations, handoffs, strict code-quality review, and
shipping a work item with [`workflows ship`](https://github.com/Vzlentin/workflows).
`home/.agents/.skill-lock.json` records upstream skill sources.

Pi discovers global skills from `~/.agents/skills/`. It loads only each skill's
name and description at
startup, then reads the full `SKILL.md` when a task needs it. Use
`/skill:<name>` to load a skill explicitly.

The Zsh aliases for `codex` and `claude` disable their approval or permission
checks. Use those aliases only in an environment where unrestricted agent
access is acceptable.

## Interactive shell

`~/.zshrc` is plain Zsh with no framework or plugin manager. It enables shared,
timestamped history that keeps only the latest copy of a repeated command,
`AUTO_CD`, `AUTO_PUSHD`, `EXTENDED_GLOB`, a case-insensitive arrow-key
completion menu, and emacs key bindings with a few additions:

| Key | Action |
| --- | --- |
| `Up` / `Down` | Walk history filtered by what is already typed |
| `Home` / `End` / `Delete` | Line start, line end, delete forward |
| `Alt+←` / `Alt+→` | Move by word; `/ = . -` end a word, so `Ctrl+W` removes one path segment |
| `Shift+Tab` | Move backwards in a completion menu |

`NO_CLOBBER`, `CORRECT`, and `edit-command-line` are present but commented out.

### Deja

[Deja](https://github.com/Giammarco-Ferranti/deja) provides inline ghost-text
suggestions from history. It is optional: the block in `~/.zshrc` only runs when
the `deja` binary is on `PATH`. To enable it:

```sh
brew install Giammarco-Ferranti/deja/deja
deja import --file "$XDG_STATE_HOME/zsh/history"
```

`--file` is required because `HISTFILE` is not exported. A local daemon starts
on first use; `deja ping` should answer `pong`.

Deja binds `Tab` to its alternatives picker by default, which breaks native
completion. This configuration moves the picker to `Ctrl+N` and installs its
own `Tab` widget, `_deja_or_complete`, so a single key serves both:

| State of the line | `Tab` does |
| --- | --- |
| Empty prompt showing a predicted command | Accept it |
| Grey text continues the current word (`cd Dev/` → `perso/dotfiles`) | Accept it |
| Fuzzy ghost (`gco ⊳ git commit …`) while on the first word | Accept it |
| Fuzzy ghost past the first word | Native completion |
| Trailing space (`git checkout ␣`), even with a ghost | Native completion |
| No ghost | Native completion |

The trailing-space row is the escape hatch: press `Tab` before starting a word
to get the completion menu instead of Deja's guess.

| Key | Action |
| --- | --- |
| `→` | Accept the whole ghost, anywhere on the line |
| `Ctrl+→` | Accept one word of the ghost |
| `Ctrl+N` | Cycle alternative suggestions |
| `Ctrl+X` | Mute suggestions for this shell session |
| `Shift+←` / `Shift+→` | Cycle the fuzzy-matching preset |
| `Shift+↑` | Toggle suggestions on an empty prompt |

`Ctrl+X` is a prefix in Zsh's emacs keymap, so Deja's binding delays chords such
as `Ctrl+X Ctrl+E` by `KEYTIMEOUT`. Set `DEJA_TOGGLE_KEY` above the Deja block
to move it if those chords are wanted.

## Neovim

`init.lua` uses lazy.nvim with four plugins: nvim-treesitter, snacks.nvim (file
tree and picker only), mini.icons, and gitsigns. `lazy-lock.json` pins their
versions; lazy.nvim installs them on the first start.

Colors come from the terminal theme. `termguicolors` is off, and
`colors/terminal.lua` uses only palette indexes 0 to 15, so a Ghostty theme
change also changes Neovim, like Herdr and Pi.

In Python files, Neovim starts `ruff server` when `ruff` is on `PATH`. Ruff
shows lint diagnostics and code actions (`gra`); it does not format on save.

| Key | Action |
| --- | --- |
| `Space e` / `Cmd+B` | Toggle the file tree; in the tree, `H` toggles hidden files and `I` toggles Git-ignored files |
| `Space Space` | Find files |
| `Space /` | Search text in the project |
| `Space ,` | Switch buffers |
| `Space f` | Format the buffer with the language server (Ruff) |
| `Tab` / `Shift+Tab` | Move in the completion menu |

## Defaults and machine overrides

Defaults written with `${NAME:-value}` preserve values that are already set.
For example, `VAULT` defaults to `~/vault`, but a machine can override it in
`~/.zprofile.local`:

```sh
export VAULT="$HOME/vault/Val"
```

Use `~/.zprofile.local` for machine-specific environment and secrets. It loads
only in login shells; child shells inherit exported values. A standalone
non-login shell receives the `.zshenv` defaults and its inherited environment,
not `.zprofile.local`. Use `~/.zshrc.local` for interactive aliases and functions.
To override the completion cache location, set `ZSH_COMPDUMP` in the inherited
environment or in `~/.zprofile.local` before Zsh loads `~/.zshrc`.

## Add a dotfile

Prefer an application's path under `.config/` when it supports XDG paths. Place
the file under `home/` at its path relative to `$HOME`, then run `./install.sh`.
For example, `home/.config/example/config.toml` becomes
`~/.config/example/config.toml`.
