# Dotfiles

Personal, XDG-oriented shell, editor, terminal, and coding-agent configuration managed with symlinks.

## Layout

| File | Responsibility |
| --- | --- |
| `~/.zprofile` | Login environment, XDG defaults, `PATH`, and tool-specific overrides |
| `~/.zshrc` | Interactive history, completion, aliases, and tool integrations |
| `~/.zprofile.local` | Machine-specific environment and secrets, not tracked |
| `~/.zshrc.local` | Machine-specific interactive settings, not tracked |
| `~/.config/ghostty/config` | Makes macOS Option send Alt key sequences for shell and TUI word editing |
| `~/.config/herdr/config.toml` | Defines Herdr navigation keys and custom popup, notification, and pane commands |
| `~/.config/herdr-mirror/hosts.toml` | Mirrors `404records`; closing local mirrors leaves remote panes running |
| `~/.config/starship.toml` | Starship prompt layout and styling |
| `~/.gitconfig` | Compatibility link that prevents a legacy Git config from overriding XDG configuration |
| `~/.config/git/config` | Global Git identity and portable GitHub credential helper |
| `~/.config/nvim/init.vim` | Provides a small Neovim configuration that follows the terminal palette (treesitter via `vim.pack`) |
| `~/.pi/agent/` | Portable Pi settings, extensions, package manifests, and shared-skill links |
| `~/.agents/` | Shared agent skills and their lockfiles |
| `bootstrap.sh` | Installs macOS or Debian tools, Starship, Bun, and uv |
| `install.sh` | Links dotfiles, installs dependencies, and installs the `campaign` CLI |

Zsh's startup files remain directly under `$HOME`; this configuration does not
set `ZDOTDIR` or install a `.zshenv`. Both startup files provide XDG base-directory
defaults so interactive non-login shells work even when `.zprofile` is not read.
New history and completion files go to `$XDG_STATE_HOME/zsh/history` and
`$XDG_CACHE_HOME/zsh/.zcompdump`, respectively. Existing Zsh history is not
imported.

Zsh loads the files as follows:

```text
Login shell:                  ~/.zprofile
Interactive shell:            ~/.zshrc
Interactive login shell:      both, in the order above
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

The installer first runs `bootstrap.sh`. The bootstrap supports macOS and
Debian and skips tools that are already available. On macOS, it uses Homebrew
for missing command-line tools and Google Chrome. On Debian, it uses
`sudo apt-get` for missing command-line tools and Chromium, except for the
Tree-sitter CLI, which it installs with npm under `~/.local`. Homebrew must
already be installed on macOS if a package is missing. The bootstrap uses the
official installers for missing Starship and Bun installations, and assumes
`curl` is available when either installer is needed. You can also run
`bootstrap.sh` by itself to provision tools without linking the dotfiles.

After bootstrapping, the installer links each file or symbolic link under
`home/` to its corresponding home path. Pi credentials, trust decisions,
sessions, histories, caches, package checkouts, and generated dependencies are
intentionally excluded. Generated JavaScript dependencies remain untracked.
The `.config`, `.cache`, `.local/share`, and `.local/state` prefixes respect
custom XDG base-directory environment variables. Existing files are replaced.
You can run the installer again safely; it skips links that are already correct.

## Campaign CLI

`./install.sh` also installs `campaign`. It clones
`Vzlentin/pi-dspy-gepa-workflows` beside this dotfiles checkout if absent,
installs its locked Node and Python dependencies, and links `campaign` into
`~/.local/bin` (already on the configured PATH). No Linux-specific home paths
or generated dependencies are synced. Requires Node 22.19 or newer; upgrade
an older existing Node installation before running the installer.

On the Mac, use the existing installer:

```sh
cd ~/Dev/perso/dotfiles
git pull --ff-only
./install.sh
campaign start --repo "$HOME/Dev/perso/calibr3" --base main --goal ./campaign.md
```

`--goal` accepts plain text or a UTF-8 file. Use your Mac's repository path;
replace any Linux-specific paths inside the brief too. Installation does not
start a campaign or copy credentials or campaign state.

Existing campaign checkouts are not pulled, reset, or overwritten. To update:

```sh
git -C ../pi-dspy-gepa-workflows pull --ff-only
./install.sh
```

Run the installer smoke test without network access or package installation:
`sh test/install-campaign.sh`.

## Coding agents

This repository configures [Pi](https://pi.dev/) and provides shared
[Agent Skills](https://agentskills.io/) for Pi and other compatible coding
agents.

### Pi

The tracked files under `home/.pi/agent/` become the global Pi configuration at
`~/.pi/agent/`:

| Path | Purpose |
| --- | --- |
| `settings.json` | Selects the default model, high thinking level, dark fullscreen UI, Neovim editor, and Pi packages |
| `models.json` | Registers a local MLX OpenAI-compatible model endpoint |
| `keybindings.json` | Holds global Pi key overrides |
| `AGENTS.md` | Gives every agent the global Herdr subagent policy |
| `extensions/` | Adds local commands, completion, skill discovery, and Herdr integration |
| `npm/package.json` and lockfile | Pin the npm packages declared in `settings.json` |
| `pi-codex-subagents/SYSTEM.md` | Gives spawned Codex subagents a small, scoped system prompt |

The custom extensions provide these behaviors:

- `/clear` starts a new session.
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

Pi also loads the npm and local packages listed in `settings.json`. The local
`pi-ipython-rlm` and `pi-autoresearch` package paths expect checkouts under
`~/Dev/perso/`. Package checkouts, generated dependencies, credentials, trust
decisions, sessions, and history are machine-local and excluded from Git.

### Shared skills

`home/.agents/skills/` is the shared skill source. It includes workflows for
architecture and domain modeling, GitHub and review work, GCP, Obsidian, web
research, visual explanations, handoffs, and strict code-quality review.
`home/.agents/.skill-lock.json` records upstream skill sources. Selected entries
under `home/.pi/agent/skills/` are symbolic links into the shared directory, so
the skill instructions are not copied.

Pi discovers global skills from both `~/.agents/skills/` and
`~/.pi/agent/skills/`. It loads only each skill's name and description at
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

## Defaults and machine overrides

Defaults written with `${NAME:-value}` preserve values that are already set.
For example, `VAULT` defaults to `~/vault`, but a machine can override it in
`~/.zprofile.local`:

```sh
export VAULT="$HOME/vault/Val"
```

Use `~/.zprofile.local` for machine-specific environment and secrets. Use
`~/.zshrc.local` for interactive aliases and functions. To override the
completion cache location, set `ZSH_COMPDUMP` in the inherited environment or
in `~/.zprofile.local` before Zsh loads `~/.zshrc`.

## Add a dotfile

Prefer an application's path under `.config/` when it supports XDG paths. Place
the file under `home/` at its path relative to `$HOME`, then run `./install.sh`.
For example, `home/.config/example/config.toml` becomes
`~/.config/example/config.toml`.

See [XDG-AUDIT.md](XDG-AUDIT.md) for the reviewed legacy paths, their supported
overrides, and the few tool-managed paths intentionally left in `$HOME`.
