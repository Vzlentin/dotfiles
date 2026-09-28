---
name: ship
description: Ship one work item, from an idea, a GitHub issue or a markdown file, onto a new branch with `workflows ship`, and report whether it shipped
argument-hint: "[--base <ref>] [--rounds <n>] [--headless] <idea | #issue | item.md>"
compatibility: Requires git, gh and uv. Runs workflows from https://github.com/Vzlentin/workflows.
disable-model-invocation: true
---
Ship the work item in the arguments below with `workflows ship`. The engine's own sessions plan,
implement, review and judge it; your job is to hand it a work item, wait, and report. Never plan,
edit or commit in the repository yourself, and never merge, push or delete the branch.

## 1. Resolve the work item

Leading `--base <ref>`, `--rounds <n>` and `--headless` flags go to `workflows ship` unchanged.
The rest is the input, and the first kind that matches wins:

1. **Markdown file**: a path to an existing `.md` file. It is the work item as it is.
2. **GitHub issue**: `#N`, `N` or an issue URL. Read it with
   `gh issue view <input> --json number,title,body` and write the work item as `# <title>`, a
   blank line, the body, a blank line, then `Closes #<number>`.
3. **Idea**: any other text. Write the work item as a `# ` heading that names the change in at
   most 70 characters, a blank line, then the text verbatim. Do not plan or expand it.

Write a new work item to `${XDG_STATE_HOME:-$HOME/.local/state}/workflows/items/<slug>.md`, where
`<slug>` is a short kebab-case name no file there has yet, so a stopped item can be shipped again.
Stop and ask when the input names nothing: a `.md` path that does not exist, or an issue `gh`
cannot find.

## 2. Run `workflows ship`

The engine runs from a clone of [workflows](https://github.com/Vzlentin/workflows) on its latest
`main`. Clone it, or bring it up to date, and stop and report if git fails:

```sh
clone="${XDG_CACHE_HOME:-$HOME/.cache}/workflows"
if [ -d "$clone" ]; then git -C "$clone" pull --ff-only
else git clone https://github.com/Vzlentin/workflows "$clone"; fi
```

The repository is the output of `git rev-parse --show-toplevel` in the current directory. Run, in
the foreground and without a timeout:

```sh
uv run --project "$clone" workflows ship --repo <repository> [flags] <work item path>
```

It runs until the item ships or stops, which takes many minutes; inside Herdr every session opens
its own pane. Wait for it: do not background it, poll it or run it twice.

## 3. Report

The first line of output is `run directory: <path>`, and the item's branch is `ship/<run>`, where
`<run>` is the last part of that path. Lead with the outcome, read from the last line:

- **shipped**: `shipped <item> in <n> rounds, judge <score>, <sha>`, exit code 0. Give the branch,
  the rounds, the score and the judge's findings from `git log -1 --format=%B ship/<run>`. A
  `judge failed` score means the commit has no `Judge` trailer. Merging it is the user's call.
- **stopped**: `stopped <item> after <n> rounds: <worktree>`, exit code 1. Give the branch, the
  worktree, and what the last review still wanted fixed, from the last `sessions/review-<n>`
  folder in the run directory.
- **failed**: anything else, such as a traceback. Quote the error.

Then give the work item path and the run directory.
