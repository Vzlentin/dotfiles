# Dotfiles

A small, XDG-oriented Zsh configuration managed with symlinks.

## Layout

| File | Responsibility |
| --- | --- |
| `~/.zprofile` | Login environment, XDG defaults, `PATH`, and tool-specific overrides |
| `~/.zshrc` | Interactive history, completion, aliases, and tool integrations |
| `~/.zprofile.local` | Machine-specific environment and secrets, not tracked |
| `~/.zshrc.local` | Machine-specific interactive settings, not tracked |
| `~/.tmux.conf` | Remote sessions, copy mode, status, and TPM plugins |
| `~/.gitconfig` | Compatibility link that prevents a legacy Git config from overriding XDG configuration |
| `~/.config/git/config` | Global Git identity and portable GitHub credential helper |
| `~/.vimrc` | Compatibility link for Vim builds that do not load XDG configuration |
| `~/.config/vim/vimrc` | Configures Vim and redirects its generated history into XDG state |
| `~/.config/nvim/init.vim` | Provides a small, plugin-free Neovim configuration |
| `~/.pi/agent/` | Portable Pi settings, extensions, package manifests, and shared-skill links |
| `~/.agents/` | Shared agent skills and their lockfiles |
| `bootstrap.sh` | Installs macOS or Debian tools, Starship, and Bun |

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
`sudo apt-get` for missing command-line tools and Chromium. Homebrew must
already be installed on macOS if a package is missing. The bootstrap uses the
official installers for missing Starship and Bun installations, and assumes
`curl` is available when either installer is needed. You can also run
`bootstrap.sh` by itself to provision tools without linking the dotfiles.

After bootstrapping, the installer links each file or symbolic link under
`home/` to its corresponding home path. Pi credentials, trust decisions,
sessions, histories, caches, package checkouts, and generated dependencies are
intentionally excluded. JavaScript dependencies remain untracked and are
recreated from the tracked lockfiles by the installer.
The `.config`, `.cache`, `.local/share`, and `.local/state` prefixes respect
custom XDG base-directory environment variables. Existing files are replaced.
You can run the installer again safely; it skips links that are already correct.

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
