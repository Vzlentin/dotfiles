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
custom XDG base-directory environment variables. Existing files move to
`~/.dotfiles-backup/<timestamp>/`. You can run the installer again safely; it
skips links that are already correct.

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
