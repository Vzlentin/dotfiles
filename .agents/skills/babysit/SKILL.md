---
name: babysit
description: Babysit a PR until it is merge-ready or reaches a bounded stop. Use after review or when late CI, review threads, or conflicts appear.
---

# babysit

Get the PR in `$ARGUMENTS` (a PR number, or blank for the current branch's
PR) to a merge-ready state: mergeable, CI green, review threads triaged. You
**never merge** — the caller owns the merge gate. Exit with the PR green, or
with a clear stop reason.

## Loop

Work these three surfaces until all are clean or a stop condition fires:

1. **Merge conflicts.** If the branch is behind its base and conflicted,
   merge the base in and resolve conflicts preserving the intent of both
   sides. If the two intents genuinely conflict, abort the merge and stop
   with `needs-human` — do not guess.
2. **Review threads.** Work every currently unresolved review thread (bots included)
   through `/resolve-review`; its fetch helper and resolution state are
   authoritative. The surface is clean when every fetched thread is resolved
   or explicitly left `needs-human` with the required decision recorded.
3. **CI.** Read the failed checks' logs and fix root causes **within this
   PR's scope**. For merge-blocking failures unrelated to this PR, check
   whether the base branch already fixed them and merge it in. Push scoped
   fixes and re-watch.

Use the CI verdict machinery the caller provides when available (the `go`
skill passes `ci_verdict.py` — its exit code is the only CI truth source:
0 green, 1 pending, 2 failure, 3 non-verdict/never-green). Otherwise use
`gh` check-run APIs; never parse rendered terminal output as a verdict.

Run the project's quality gates in the foreground before every push; never
push a red tree.

## Bounds and guardrails

- **Max 3 fix iterations.** After the third failed CI cycle, stop.
- **Repeated-signature stop.** If the same failure signature comes back
  twice in a row, stop immediately — re-running an unchanged failure is not
  progress. Glance at the logs first to confirm it is genuinely the same
  failure.
- **Never** weaken assertions, skip or delete tests, change CI
  checks/workflows to make failures pass, or make unrelated code changes.
  If that is what turning CI green would take, stop and report instead.

## Exit

Report one of:

- **green** — PR mergeable, CI green, review threads triaged; hand back to the
  caller for the merge gate.
- **stopped** — the bound that fired (iterations / repeated signature /
  intent conflict / out-of-scope failure), what was tried, and the exact
  failing state left behind.
