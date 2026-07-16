---
name: implement
description: Implement a unit of work from a spec or plan on a feature branch, TDD at pre-agreed seams, quality gates in the foreground, finishing with a pushed branch and a PR that closes the backing issue.
---

# implement

Implement the work described in `$ARGUMENTS` — a plan path, a spec, or a
filled brief carrying the branch, working directory, and issue number.

Adapted from Matt Pocock's `implement` skill
(<https://github.com/mattpocock/skills>); this version adds the branch/PR
contract and deliberately drops his closing self-review step — review is a
separate later stage owned by the caller.

## Setup

Work on a feature branch, never the default branch. When the brief names a
branch and working directory, use exactly those (they may already exist —
worktree mode); otherwise create `<type>/<slug>` from an up-to-date default
branch. Do not stop to ask which branch. Treat the provided spec as complete:
do not re-plan or ask to narrow scope. If it requires an unresolved product
decision, stop and report the blocker instead of guessing.

## Build

- Use TDD where practical, at pre-agreed seams: write the failing test for a
  behavior slice, observe the failure, then implement. Skip the ceremony for
  non-behavioral work (pure config, docs, renames) — note the skip.
- Follow the project's existing conventions and reuse the patterns the spec
  points at; when in doubt, grep for a similar implementation and mirror it.
- Run the typecheck and the targeted tests for changed files regularly while
  building; run the full suite once at the end.
- Commit in logical units with conventional messages as you go.

## Finish

1. Run the project's quality gates (as its `AGENTS.md`/CI define them) in the
   **foreground**, blocking on each exit code. Never end with a gate still
   running in the background. Commit only on green.
2. Assume the repo is public: no client names, partners, or private
   commercial context in code, commit messages, or the PR.
3. Push the branch and open a PR: title <=70 chars, body with a 3-bullet
   summary, a test-plan checklist, and `closes #N` for the backing issue.
4. Report back: PR number, PR URL, branch name, and gate results.

Do not review your own work beyond the gates, and do not merge — review and
merge belong to later pipeline stages.
