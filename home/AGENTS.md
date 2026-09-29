# Shared development rules

## Communication

- When you talk to me, use ASD-STE100 Simplified Technical English.
- For text other people read, including code comments, commit messages, and PR or review text, load the `outbound-writing` skill.
- Do not use em-dashes.

## Workspace

- Work only in the requested repository or worktree. Before editing or using Git, verify the repository root, branch, status, worktree, and local instructions. Preserve unrelated and untracked user work.
- Use the commands, configuration, and lockfile declared by the repository. Do not invent commands or change dependency and tooling files only to bootstrap the environment.
- Keep changes small and consistent with the existing codebase. Do not add speculative abstractions, instrumentation, manifests, or unrelated cleanup.

## Code and testing

- In Python, use module-level imports and functions. Do not use nested imports or nested functions.
- Test production behavior. Do not add tests for helper scripts or benchmarks unless requested.

## Safety

- Do not commit, push, publish branches, create or update pull requests or merge requests, or post comments without explicit permission.
- Treat external services and shared environments as real systems. Prefer read-only operations and obtain explicit approval before writes or shared workflow execution.
- Never commit credentials, tokens, sensitive data, or temporary verification artifacts.

## Verification

- Run the smallest relevant check first, then the repository's documented quality targets when practical.
- Before delivery, inspect the scoped diff and run `git diff --check`.
- Report what passed and what was not verified.
