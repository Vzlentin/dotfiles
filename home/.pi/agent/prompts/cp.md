---
description: Commit changes atomically and push to the configured upstream
---
Invoking `/cp` explicitly authorizes you to commit and to push the current branch to its configured upstream, and nothing else.

1. Read and follow the shared and repository `AGENTS.md` rules. Verify the repository root, branch, status, and worktree.
2. Resolve the upstream remote and full ref. Do not assume the upstream branch has the local name. Stop if HEAD is detached or the upstream is missing or unclear.
3. The scope is the changes this conversation made or named. If there are none, it is every tracked change in the worktree. Do not ask which changes to commit. Add an untracked file only if this conversation created it or a change in scope needs it. Leave secrets, temporary artifacts, and all other work untouched, and list them in the report. Stop if the index holds changes this conversation did not stage. Do not stash or use an alternate index to bypass this. If the scope is empty, report that and stop.
4. Run the relevant repository checks, smallest first, then the documented quality targets when practical, and `git diff --check`. Stop if a required check fails or cannot run.
5. Split the scope into atomic commits, one logical change each. For each one, stage its changes with explicit paths or selected hunks, confirm the staged diff holds only that change, and run `git diff --cached --check`. If you edit a file, rerun the checks. Load the `outbound-writing` skill before writing commit messages, and follow the repository's commit style. Stop if a commit fails.
6. After all commits succeed, run `git push -- <remote> HEAD:<upstream-ref>` with the resolved values, never bare `git push`. Stop and report any push failure.
7. Report each commit, where you pushed it, which checks passed, and what remains unfinished, including the work you left out.

Never create or change an upstream, rewrite history, force push (even with `--force-with-lease`), or create or update a pull request.
