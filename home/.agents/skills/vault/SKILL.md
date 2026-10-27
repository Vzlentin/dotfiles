---
name: vault
description: The user's Obsidian vault ($VAULT, ~/vault by default), with his notes, project records, contracts and daily notes. Use to find what he already wrote or decided, and to write or update a note, a record or an index. Covers where notes go, Obsidian Flavored Markdown, the Obsidian CLI and Git.
---

# vault

The vault is `$VAULT` (`~/vault` by default): an Obsidian vault and a private Git repository.

## Read

- Read `$VAULT/AGENTS.md` first. A nested `AGENTS.md` overrides it for its folder.
- To find a note, start at the nearest `_index.md` and follow the wikilinks, or search with `rg`.
- When Obsidian runs, the `obsidian` CLI also gives search, backlinks and properties. See `obsidian help`.

## Write

- Obsidian Flavored Markdown. Use wikilinks for notes in the vault.
- A new note goes in the folder of its owner and topic, for example `Val/Harness/<slug>.md`. Give it a `type:`, and add its line to the `_index.md` of that folder.
- Before you edit: `git status`, then `git pull --ff-only` if the tree is clean.
- Commit only with the user's OK, then push to `origin`.
