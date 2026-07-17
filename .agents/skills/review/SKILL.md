---
name: review
description: Review a PR and post actionable findings as resolvable inline threads. Use for PR code review or when an orchestration pipeline reaches review.
---

# review

Review the PR in `$ARGUMENTS` (a PR number, or blank for the current
branch's PR) with a panel of read-only persona analysts, and post the
findings where they can be worked: **resolvable inline review threads on the
PR**. Zero findings is a valid outcome.

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

Assign every analyst finding exactly one recorded disposition:

- **Post** when it has quoted evidence and a real `file:line`.
- **Deduplicate** by file + line (±3) + issue into a named posted finding; keep
  the highest severity and record every persona that corroborated it.
- **Drop** with a concrete reason when evidence/location validation fails or
  calibration finds only unsupported taste.

Calibrate before posting: P0 = breakage/vulnerability/data loss, P1 = likely
defect in normal use, P2 = meaningful edge case or maintainability trap,
P3 = minor. Two or more corroborating personas are the strongest signal; name
them in the thread body. Step 3 is complete when every input finding appears
once in the disposition record.

## Step 4 — Post as resolvable PR threads

Post each surviving actionable finding as an **inline review comment** so the
resolve stage has threads to work:

```bash
gh api "repos/{owner}/{repo}/pulls/<pr>/comments" \
  -f commit_id="<headRefOid>" -f path="<file>" -F line=<line> \
  -f side=RIGHT -f body="<severity + finding + quoted evidence + suggested fix>"
```

Use the PR head SHA from Step 1 as `commit_id`. Anchor a cross-file/design
finding as an inline thread too, on the most representative changed line —
**not** as a top-level `gh pr comment`: the whole pipeline runs under one gh
identity, so a top-level comment is authored by the PR author and the
resolve stage's own-comment filter would silently drop it. Only inline
threads are guaranteed to reach the resolve stage. Do not push code, do not
fix anything here — review only.

Finish with a summary: personas run; every finding disposition (posted with
severity and thread URL, deduplicated into which post, or dropped with reason);
and "zero findings" when every persona returned clean.
