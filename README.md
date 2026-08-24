# Dotfiles

A small, XDG-oriented Zsh configuration managed with symlinks.

## Layout

| File | Responsibility |
| --- | --- |
| `~/.zprofile` | Login environment, XDG defaults, `PATH`, and tool-specific overrides |
| `~/.zshrc` | Interactive history, completion, aliases, and tool integrations |
| `~/.zprofile.local` | Machine-specific environment and secrets, not tracked |
| `~/.zshrc.local` | Machine-specific interactive settings, not tracked |
| `~/.config/git/config` | Global Git identity and GitHub credential helper |
| `~/.config/vim/vimrc` | Configures Vim and redirects its generated history into XDG state |
| `~/.config/nvim/init.vim` | Provides a small, plugin-free Neovim configuration |

Zsh's startup files remain directly under `$HOME`; this configuration does not
set `ZDOTDIR` or install a `.zshenv`. Both startup files provide XDG base-directory
defaults so interactive non-login shells work even when `.zprofile` is not read.
Generated history and completion files go to `$XDG_STATE_HOME` and
`$XDG_CACHE_HOME`, respectively.

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
./install.sh
```

The installer links each file under `home/` to its corresponding home path.
The `.config`, `.cache`, `.local/share`, and `.local/state` prefixes respect
custom XDG base-directory environment variables. Existing files move to
`~/.dotfiles-backup/<timestamp>/`. You can run the installer again safely; it
skips links that are already correct.

## Add a dotfile

Prefer an application's path under `.config/` when it supports XDG paths. Place
the file under `home/` at its path relative to `$HOME`, then run `./install.sh`.
For example, `home/.config/example/config.toml` becomes
`~/.config/example/config.toml`.

See [XDG-AUDIT.md](XDG-AUDIT.md) for the reviewed legacy paths, their supported
overrides, and the few tool-managed paths intentionally left in `$HOME`.
