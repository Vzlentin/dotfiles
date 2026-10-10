---
name: ship
description: Ship one work item, from an idea, a GitHub issue or a markdown file, onto a new branch with `workflows ship`, and report whether it shipped
argument-hint: "[--base <ref>] [--rounds <n>] <idea | #issue | item.md>"
compatibility: Requires git, gh and the `workflows` command (`npm ci && npm run build && npm link` in ~/Dev/perso/workflows).
disable-model-invocation: true
---
Ship the work item in the arguments below with `workflows ship`. The engine's own sessions plan,
implement, review and judge it; your job is to hand it a work item, wait, and report. Never plan,
edit or commit in the repository yourself, and never merge, push or delete the branch.

## 1. Resolve the work item

Leading `--base <ref>` and `--rounds <n>` flags go to `workflows ship` unchanged. The rest is the
input, and the first kind that matches wins:

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

The engine is the `workflows` command, linked with `npm link` from `~/Dev/perso/workflows`. It runs
that checkout's built `dist/`, so a change on its `main` takes effect only after `npm run build`
there. Stop and report if `command -v workflows` finds nothing.

The repository is the output of `git rev-parse --show-toplevel` in the current directory. Run, in
the foreground and without a timeout:

```sh
workflows ship --repo <repository> [flags] <work item path>
```

It runs headless until the item ships or stops, which takes many minutes, and prints one progress
line on stderr as each session starts: `plan`, `round <n>: implement`, `round <n>: review`, `judge`.
Wait for it: do not background it, poll it or run it twice.

## 3. Report

The first line of output is `run <run-id>`. The item's branch is `ship/<run-id>`, and the run
directory is `${XDG_STATE_HOME:-$HOME/.local/state}/workflows/runs/<run-id>`, with the worktree in
`worktree/` and the patches each review got in `round-<n>.patch` and `round-<n>-fix.patch`. Lead with
the outcome, read from the last `shipped`, `stopped`, `blocked`, `failed` or `interrupted` line:

- **shipped**: `shipped <subject> in <n> rounds, judge <score>, <commit>`, exit code 0. Give the
  branch, the rounds, the score and the judge's findings from
  `git -C <run directory>/worktree log -1 --format=%B`. A `judge failed` score means the commit has
  no `Judge` trailer. Merging it is the user's call.
- **stopped**: `stopped <subject> after <n> rounds: <worktree>`, exit code 1. Give the branch, the
  worktree and the last round's patches. The review's findings are only in the run's store, and
  `workflows` has no command to print them yet; do not guess them.
- **blocked**: `blocked <subject> after <n> rounds: <worktree>`, then the implementer's reply, exit
  code 1. A round changed nothing. Give the branch, the worktree and the implementer's reply, which
  says why.
- **failed**: `failed <subject>: <error>`, then `continue with: workflows ship resume <run-id>`, exit
  code 1, for example a failing Git hook or a model error that remained after Pi's retries. Quote
  the error and give the resume command. Do not resume it yourself.
- **interrupted**: `interrupted; continue with: workflows ship resume <run-id>`, exit code 130. Give
  the resume command.
- Anything else, such as a stack trace: quote the error.

Then give the work item path and the run directory.
