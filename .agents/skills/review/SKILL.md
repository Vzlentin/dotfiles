---
name: review
description: Multi-persona code review of a PR — parallel read-only analysts return structured findings, the orchestrator dedups and corroborates, then posts actionable findings as resolvable inline PR threads via gh.
---

# review

Review the PR in `$ARGUMENTS` (a PR number, or blank for the current
branch's PR) with a panel of read-only persona analysts, and post the
findings where they can be worked: **resolvable inline review threads on the
PR**. Zero findings is a valid outcome.

Architecture adapted (radically leaner) from the compound-engineering
`ce-code-review` skill by Every (<https://github.com/EveryInc/compound-engineering>).

## Step 1 — Scope

Resolve the PR (`gh pr view --json number,title,body,headRefOid,baseRefName`)
and compute the diff from the merge base (`git diff -U10 $(git merge-base
HEAD origin/<base>)`). Read the PR title/body for intent. If the working tree
is not the PR head, stop and report rather than reviewing the wrong tree.

## Step 2 — Fan out persona analysts

Pick personas from `references/personas/` in this skill's directory:

- `correctness.md`, `testing.md`, `project-standards.md`, and
  `thermo-nuclear-code-quality.md` (harsh maintainability) — always.
- `security.md` — when the diff touches auth, permissions, user input,
  secrets, subprocess/shell, or network boundaries.
- `adversarial.md` — when the diff is large (>=50 changed executable lines)
  or touches money, data mutation, external APIs, or any verification
  mechanism that could silently pass (CI gates, test harnesses, merge
  checks).

Launch the selected personas as **blocking, read-only analysts in parallel**
via the harness's native subagent mechanism (pi recipe: the `go` skill's
`references/harness/pi.md`; no mechanism: run them inline sequentially).
Each analyst's task text = the persona file content, pasted verbatim + the
intent summary + the diff (or its path) + this output contract:

> Return findings as a list. Each: `P0|P1|P2|P3 — file:line — title — the
> verbatim motivating line quoted — why it matters — suggested fix (when
> concrete)`. Quote-the-line is mandatory: no quoted evidence, no finding.
> Only findings introduced or made reachable by this diff; pre-existing
> issues only when the diff depends on them. Zero findings is valid.

## Step 3 — Merge

- **Validate**: drop findings without quoted evidence or a real `file:line`.
- **Dedup** by file + line (±3) + issue; keep the highest severity and note
  every persona that flagged it.
- **Corroborate**: 2+ personas on the same finding is the strongest signal —
  say so in the thread body.
- **Calibrate**: P0 = breakage/vulnerability/data loss, P1 = likely defect in
  normal use, P2 = meaningful edge case or maintainability trap, P3 = minor.
  Drop pure-taste nits that the project's linter or conventions don't back.

## Step 4 — Post as resolvable PR threads

Post each surviving actionable finding as an **inline review comment** so the
resolve stage has threads to work:

```bash
gh api "repos/{owner}/{repo}/pulls/<pr>/comments" \
  -f commit_id="<headRefOid>" -f path="<file>" -F line=<line> \
  -f side=RIGHT -f body="<severity + finding + quoted evidence + suggested fix>"
```

Use the PR head SHA from Step 1 as `commit_id`. A finding that has no single
anchorable line (cross-file/design) goes in one summary review comment
(`gh pr comment`) instead. Do not push code, do not fix anything here —
review only.

Finish with a summary: personas run, findings posted per severity (with
thread URLs), findings dropped in validation, or "zero findings" when clean.
