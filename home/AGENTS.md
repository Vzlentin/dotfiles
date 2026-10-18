## Communication

- Reply in the language I write in.
- In English, use ASD-STE100 Simplified Technical English. In other languages, apply the same principles: short sentences, active voice, one instruction per sentence, common words, consistent terms.
- For text other people read, including code comments, commit messages, and PR or review text, load the `outbound-writing` skill.
- Do not use em-dashes.

## Workspace

- Work only in the requested repository or worktree. Before editing or using Git, verify the repository root, branch, status, worktree, and local instructions. Preserve unrelated and untracked user work.
- Use the commands, configuration, and lockfile declared by the repository. Do not invent commands or change dependency and tooling files only to bootstrap the environment.
- Keep changes small and consistent with the existing codebase. Do not add speculative abstractions, instrumentation, manifests, or unrelated cleanup.

## Code

- In Python, use module-level imports and functions. Do not use nested imports or nested functions.
- Leave no breadcrumbs. Code and docs describe the current state only: no "removed", "moved to", "previously", "now uses", or "changed from" comments, no commented-out old code, and no compatibility aliases or re-exports for renamed things unless requested. Change history belongs in the commit message.

## Testing

- Test production behavior. Do not add tests for helper scripts or benchmarks unless requested.
- Do not write tautological tests. A test must be able to fail when the behavior breaks. Do not assert that a mock returns what you configured, that a constant equals itself, or that output matches an expected value computed by the code under test.

## Safety

- Do not commit, push, publish branches, create or update pull requests or merge requests, or post comments without explicit permission.
- Treat external services and shared environments as real systems. Prefer read-only operations and obtain explicit approval before writes or shared workflow execution.
- Never commit credentials, tokens, sensitive data, or temporary verification artifacts.

## Verification

- Run the smallest relevant check first, then the repository's documented quality targets when practical.
- Before delivery, inspect the scoped diff and run `git diff --check`.
- Report what passed and what was not verified.
