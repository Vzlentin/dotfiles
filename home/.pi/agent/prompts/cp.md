---
description: Commit intended changes and push to the configured upstream
---
Invoking `/cp` explicitly authorizes you to commit the intended changes from the current task and push the current branch to its configured upstream.

Follow this order:

1. Read and follow the applicable shared and repository `AGENTS.md` rules. Before making changes, verify the repository root, branch, status, worktree, and local instructions.
2. Resolve the current branch's configured upstream remote and full branch ref before changing files or the index. Do not assume the upstream branch has the same name as the local branch. Stop if HEAD is detached or the upstream is missing or unclear.
3. Identify the intended changes from the current task context, not every dirty file. Stop if the scope is unclear or unrelated changes are already staged. Preserve unrelated and untracked work. Do not stash or use an alternate index to bypass this stop.
4. Run the relevant repository checks required by `AGENTS.md`, starting with the smallest relevant check, then the documented quality targets when practical. Run `git diff --check`. Stop if a required check fails or cannot be run.
5. Stage only intended changes with explicit paths or selected hunks. Review the final staged diff and confirm that it contains only the intended changes. Run `git diff --cached --check`. If changes are needed, repeat the relevant checks and staged diff review. If there is nothing to commit, report that and stop.
6. Load the `outbound-writing` skill before composing the commit message. Follow the repository's commit style. Commit only after all required checks pass. Stop if the commit fails.
7. Only after the commit succeeds, push explicitly to the resolved upstream remote and branch with `git push -- <resolved-remote> HEAD:<resolved-upstream-ref>`. Replace the placeholders with the resolved values. Do not use bare `git push`. Stop and report any push failure.
8. Report what was committed, where it was pushed, which checks passed, and what remains unfinished.

Do not create or change an upstream, rewrite history, or use any force push, including `--force-with-lease`. Do not create or update a pull request.
