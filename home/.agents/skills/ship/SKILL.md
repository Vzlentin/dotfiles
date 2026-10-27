---
name: ship
description: Ship one work item, from an idea, a GitHub issue or a markdown file, onto a new branch with the `workflow` tool, and report whether it shipped
argument-hint: "[--base <ref>] [--rounds <n>] <idea | #issue | item.md>"
compatibility: Requires git, gh, the `workflow` tool of the workflows Pi package, and the `workflows` command for `show`.
disable-model-invocation: true
---
Ship the work item in the arguments below with the `workflow` tool. The engine's own sessions plan,
implement, review and judge it; your job is to hand it a work item, wait, and report. Never plan,
edit or commit in the repository yourself, and never merge, push or delete the branch.

## 1. Resolve the work item

Leading `--base <ref>` and `--rounds <n>` flags become the `base` and `rounds` args of the tool.
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

## 2. Run the `workflow` tool

Use the `workflow` tool. Do not run `workflows ship` through bash, and do not rebuild
`~/Dev/perso/workflows`: the tool runs the Pi package's own source. Stop and report if the tool is
not available.

The repository is the output of `git rev-parse --show-toplevel` in the current directory. Call the
tool once, with absolute paths:

```js
{ name: "ship", args: { item: "<absolute work item path>", repo: "<repository>", base?: "<ref>", rounds?: <n> } }
```

It runs headless until the item ships or stops, which takes many minutes, and shows one progress
step as each phase starts: `research`, `plan`, `implement`, `round <n>/<rounds>: review`,
`round <n>/<rounds>: implement`, `judge`. Wait for it: do not poll it or call it twice.

## 3. Report

The result is `{ runId, status, result?, report?, error? }`. The item's branch is `ship/<runId>`
until the item ships. A shipped item gets a branch named from its commit subject, such as
`feat/<slug>` for `feat: <subject>`: read it from `result.branch` and the `branch <name>` report
line. The run directory is `${XDG_STATE_HOME:-$HOME/.local/state}/workflows/runs/<runId>`, with the
worktree in `worktree/` and the patches each review got in `round-<n>.patch` and
`round-<n>-fix.patch`. Lead with the outcome. For a `finished` status, read it from `result.status`
and the `report` lines:

- **shipped**: `shipped <subject> in <n> rounds, judge <score>, <commit>`. Give the branch, the
  rounds, the score and the judge's findings from `result.findings`. The change is one squashed
  commit, with the subject and body that the judge wrote. A `judge failed` score means the judge
  gave no verdict: `result.judgeError` says why, and the commit message is only the item's
  subject. Merging it is the user's call.
- **stopped**: `stopped <subject> after <n> rounds: <worktree>`. Give the branch, the worktree, the
  last round's patches and the last review's findings. Read the findings from the run's store with
  `workflows show <runId> --json`: the review rounds run in the `thermoloop` child run, so look in
  the `calls` of its `run` call, at the `ask` calls under the phase `round <n>/<rounds>: review` of
  the last round. `show` only reads the store. Do not guess the findings.
- **blocked**: `blocked <subject> after <n> rounds: <worktree>`. A round changed nothing. Give the
  branch, the worktree and the implementer's reply from `result.reply`, which says why.
- **failed** status: `error` holds the error, for example a failing Git hook or a model error that
  remained after Pi's retries. Quote the error and say that the `workflow` tool with
  `{ resume: "<runId>" }` continues the run. Do not resume it yourself.
- **interrupted** status: the run was stopped. Say that `{ resume: "<runId>" }` continues it.
- A tool error before a run exists, such as bad usage: quote the error.

Then give the work item path and the run directory.
