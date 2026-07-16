---
name: go
description: Implementation-orchestration pipeline. Given a plain idea, a GitHub issue (#N / number / roadmap code), or a path to a plan file, drive it end-to-end to a merged PR with persisted outcome.
---

You are running the implementation-orchestration pipeline for the work item in
`$ARGUMENTS`. Execute the stages **in order**. By default, every run ends in
exactly one **terminal outcome** — `shipped` (PR squash-merged) or `failed` (a
stage stopped short) — persisted to the plan store by Stage 8.

Each stage ends in a **GATE**: if the stage did not do its job, stop — do not
paper over a failed stage to reach the next one. A short-stopping GATE **is** the
`failed` outcome: it routes to Stage 8 to persist `failed` (when a plan already
exists), then reports.

`/go` accepts three input kinds — a **plain idea**, a **GitHub issue** (`#N`,
number, or roadmap code like `U3`), or a **path to a plan file**. It resolves the
input to a concrete plan in the store resolved by `/project-memory` (the vault,
or the `docs/plans/` fallback; invoking `/plan` when none exists), guarantees
a backing issue so `closes #N` keeps working, then implements. The plan is the
work order; the issue is the close-handle.

## Script invocation

Resolve `SKILL_DIR` **once** at the start of the run — the absolute directory
containing this SKILL.md — and invoke every skill script through it:

```bash
python3 "$SKILL_DIR/scripts/<script>.py" …
```

The scripts are stdlib-only (Python ≥ 3.11); no project environment or
package-manager prefix is required to run them.

## Run mode

Parse `$ARGUMENTS` before Stage 0:

- **Ship mode (default):** no flag. Run the full pipeline, including squash-merge
  and cleanup after green CI.
- **Handoff mode:** `--no-merge` as the first argument. Remove the flag from the
  work-item input, then run the same pipeline through CI, but do **not**
  squash-merge, delete branches, remove worktrees, or mark the plan terminal.
  Preserve the PR branch/worktree and report `ready-for-external-gates` when the
  PR is green. Use this only when an outer orchestrator owns extra gates before
  merge, such as architecture review, benchmark acceptance, or a campaign-level
  autonomous merge policy.

All safety gates still apply in handoff mode. A failed implementation, review,
feedback, or CI gate is still `failed`; only the post-green merge step is
deferred.

**Multi-line invocations.** Only the **first line** of `$ARGUMENTS` is the
work-item input. Any following lines are **campaign context** — standing
instructions from an outer loop (a campaign-plan reference, routing
reminders). Honor them at the stage they address, but they never change the
Stage 0 input classification, and a referenced campaign plan is planning
*input*, never the unit's resolved plan (Stage 1 still makes a unit plan).

## Project rules that bind every stage

- **Read the project's rules first.** The target repo's `AGENTS.md` (or
  equivalent agent instructions) carries the project's quality gates,
  guardrails, frozen baselines, and routing examples. They bind every stage
  of this run.
- **Quality gates are the project's own.** Run the gate commands (lint, type
  check, tests) as the project's `AGENTS.md` and CI define them — discover
  them there; there is no separate config layer.
- **Storage is delegated.** The plan store and outcome persistence are resolved by
  `/project-memory`.
- **Public repo, private context stays out.** Assume the target repo is public.
  No client names, partners, or private commercial context in commit messages,
  the PR title/body, or issue comments.
- **Squash + `closes #N`.** Merge is squash-only; the PR body must carry
  `closes #N` so the issue closes and roadmap status updates for free.

---

## Invocation model

Each stage delegates to a stage skill; how it's invoked depends on who owns
the fan-out:

- **Implementer subagent (Stage 3):** launch **one blocking, full-capability
  implementer child** in `WORKDIR` via the harness's native subagent
  mechanism, running `/implement` with the filled brief. The child is
  synchronous — the launch returns when the implementation is done — and its
  surface stays inspectable while it runs. The concrete launch recipe for
  this harness lives in `references/harness/pi.md`; adding a harness means
  adding one file there, not editing this SKILL.md.
- **Inline (the `/go` agent runs the skill directly):** `/plan`, `/simplify`,
  `/review`, `/resolve-review`, `/babysit`. `/plan` runs inline so any
  clarifying gate can reach you; `/simplify` and `/review` own their own
  analyst fan-out (also specified in the harness recipe), so `/go` runs them
  itself rather than nesting fan-out inside another subagent.

`/go` never runs the implementation itself and never launches it through a
mechanism that hides it — the implementation stays a first-class, inspectable
worker.

---

## Stage 0 — Resolve the input

Classify the work-item input (after removing `--no-merge`, if present) into one
of three kinds, in this order — first match wins:

1. **Plan-file** — `$ARGUMENTS` resolves to an existing `.md` file (e.g.
   `2026-06-06-001-feat-foo-plan.md`). Open it and check it is an
   *executable plan* — it has implementation units / phases (`### U1`,
   `## Implementation units`, numbered tasks with files). A
   brainstorm/ideation doc with no implementation units is **not**
   executable: carry it as a planning seed for Stage 1 to turn into a plan
   via `/plan`.
2. **Issue** — else if `$ARGUMENTS` matches `^#?\d+$` (number or `#N`) or a
   roadmap code `^[A-Za-z]+\d+$` (e.g. `U3`), resolve it to a GitHub issue:

   ```bash
   gh issue view <N> --json number,title,body,state,milestone,labels   # if numeric
   gh issue list --search "<code> in:title,body" --state open --json number,title  # if a code
   ```

   Read the full issue body — it seeds planning. Note the number `N` and title.
3. **Idea** — else treat `$ARGUMENTS` as free text describing the work to do.

Derive a short slug (e.g. `u3-parser-coverage`) from the chosen artifact for
branch naming and memory, then initialize the run state — one flat JSON dict
per run at `<git-common-dir>/go-runs/<slug>.json` (private by construction,
shared between the main checkout and worktrees). Stages record progress into
it as they land (`classification` at 0; `issue` at 1; `mode`, `workdir`,
`branch` at 2; `pr` at 3; `head_sha` at 7; `outcome` at 8), so a new session
resumes by reading the state instead of rediscovering the PR/branch/worktree.
`issue` and `outcome` are **mandatory** — an outer campaign loop reads exactly
those two keys to advance its queue:

```bash
python3 "$SKILL_DIR/scripts/run_state.py" init <slug>
python3 "$SKILL_DIR/scripts/run_state.py" get <slug>   # resume: read prior state
python3 "$SKILL_DIR/scripts/run_state.py" list         # forgot the slug? list runs
```

On **resume**, only `get` — never `init --force`, which wipes the recorded
PR/branch/worktree and defeats the resume. `init` without `--force` refuses an
existing slug, so a plain re-`init` is safe.

**GATE:** the input resolved to exactly one of {plan-file, issue, idea}. If it is
ambiguous — a `.md` path that does not exist, or a number/code that resolves to
no issue — stop and ask.

---

## Stage 1 — Ensure a plan and a backing issue

**Plan.**

- **Plan-file (executable):** that file is the plan.
- **Issue / Idea / brainstorm (or non-executable plan-file):** find an existing
  plan in the resolved store, else create one via `/plan` (run **inline**):
  - **Issue:** search the plan store for a plan whose `origin:` or body
    references `#N`. If found, use it; else seed `/plan` with the issue title
    + body.
  - **Idea / brainstorm:** keyword/slug search plan titles + filenames. On a
    *plausible* match, **confirm with the user before reusing** (a wrong reuse is
    worse than a fresh plan); on no match, seed `/plan` with the idea text /
    the brainstorm's full contents. A brainstorm is **never** executable on its
    own and is **never** fed to Stage 3 as the spec — it must become a plan first.

  `/plan` delegates placement to `/project-memory` (vault store, or the
  `docs/plans/` fallback) — delegate placement there rather than moving files
  here.

**Issue.** Every run opens a PR that carries `closes #N`; in ship mode that
merge closes the issue, and in handoff mode the close-handle remains ready for
the outer merge workflow. Guarantee an issue exists:

- **Reuse** when the work item already has one — the **Issue** input's `#N`, or a
  plan carrying `origin: "GitHub issue #N — …"`. Do not create a duplicate.
- **Create** otherwise. Open an issue with a ≤70-char title and a **public-safe**
  body summarizing the plan — no client names, partners, or private commercial
  context (the full plan stays in the plan store; only the public-safe summary
  becomes the issue body). Capture the new number `N`:

  ```bash
  gh issue create --title "<≤70-char title>" --body-file <public-safe summary>
  ```

Record `origin: "GitHub issue #N — <short>"` in the plan's frontmatter, and
record the number in the run state — the campaign loop keys on it:

```bash
python3 "$SKILL_DIR/scripts/run_state.py" set <slug> issue <N>
```

**GATE:** a plan file for this work item exists in the resolved store, **and** a
usable `#N` exists, recorded on the plan and in the run state (`issue` key). If
`/plan` produced nothing or issue creation failed, stop and report.

---

## Stage 2 — Choose execution location and provision

Stages 3–7 run against a working directory `WORKDIR`, picked with a smart-worktree
gate so the user's current checkout — their branch *and* any uncommitted work —
is never disturbed. Both the mode decision and the provisioning are owned by
`$SKILL_DIR/scripts/provision_worktree.py` (rationale and caveats in
`references/worktree-provisioning.md`). From the main checkout:

```bash
python3 "$SKILL_DIR/scripts/provision_worktree.py" decide
```

prints `{"mode": "direct"|"worktree", "main": <MAIN path>}`:

- **`direct`** (on `main` AND clean): `WORKTREE_MODE=false`, `WORKDIR="$MAIN"`.
  No provisioning — the implementer branches inside this checkout.
- **`worktree`** (any other branch, detached HEAD, or dirty tree):
  `WORKTREE_MODE=true`. Provision an isolated worktree on a fresh branch cut
  from `origin/main`, so neither the user's branch nor their dirty tree moves —
  `<type>` is the conventional-commit kind of the work, `<slug>` is the
  Stage 0 slug:

```bash
python3 "$SKILL_DIR/scripts/provision_worktree.py" provision <type>/<slug>
```

The script reads the setup steps dynamically from the project's
`.cursor/worktrees.json` when present (absent config → plain
`git worktree add`, no setup steps), aborts on the first failed step, refuses
an existing worktree/branch collision, and never mutates the caller checkout.
On success it prints
`{"workdir": <absolute path>, "branch": <type>/<slug>}` — take `WORKDIR` from
the `workdir` field. On a failure after the worktree was created, it prints
the recovery commands for the debris; run them before retrying.

`WORKDIR` is where Stages 3–7 operate. From here on, every shell command for those
stages uses an explicit `cd "$WORKDIR" && …` in worktree mode (a
`working_directory` arg can silently target the main repo); in direct mode the
`cd` is a harmless no-op. Stage 8 is the exception — it always runs from `$MAIN`.

Record the decision in the run state:

```bash
python3 "$SKILL_DIR/scripts/run_state.py" set <slug> mode <direct|worktree>
python3 "$SKILL_DIR/scripts/run_state.py" set <slug> workdir "$WORKDIR"
python3 "$SKILL_DIR/scripts/run_state.py" set <slug> branch <type>/<slug>
```

**GATE (worktree mode):** `provision` exited 0 — that exit code *is* the
provisioned worktree. If it exited non-zero, stop and report — do **not**
fall back to mutating the user's dirty checkout. In direct mode this gate is
automatically satisfied.

---

## Stage 3 — Implement (one blocking implementer subagent)

Launch **one blocking implementer subagent in `WORKDIR`** running `/implement`
(see Invocation model; concrete launch recipe in `references/harness/pi.md`).
Its task text is this brief, filled in — `#N`, `<type>/<slug>`, `<WORKDIR>`,
the mode clause, and the plan path from the resolved store:

> Invoke the `implement` skill (`/skill:implement`) for GitHub issue #N.
> Treat the plan at `<plan path>` as the complete spec — do not re-plan, do
> not ask to narrow scope.
>
> Setup, non-interactively — use the clause for this run's mode:
> - **Direct mode:** from an up-to-date `main`, create the feature branch
>   `<type>/<slug>` in this checkout. Do not commit to `main`.
> - **Worktree mode:** the branch and worktree already exist. Work in
>   `<WORKDIR>` on the existing `<type>/<slug>` branch — do **not** create a
>   branch, do **not** touch the main checkout.
>
> Finish per the implement skill's Finish contract: push the branch, open a
> PR whose body includes `closes #N`, and report back the PR number, PR URL,
> branch name, and quality-gate results.

The subagent is synchronous: when the launch returns, the implementation is
done (or failed). Do not parse its rendered output as the result contract —
verify the durable artifacts from their authoritative sources. Then sync by
mode — never move the main checkout onto the PR branch in worktree mode:

- **Direct mode:** the implementer branched in this checkout — check out the PR
  branch here and fast-forward:

```bash
gh pr checkout <PR>
git pull --ff-only
```

- **Worktree mode:** leave the main checkout where the user left it. The
  worktree is already on `<type>/<slug>`; just fast-forward it:

```bash
cd "$WORKDIR" && git pull --ff-only
```

**GATE:** a PR exists for this branch (`gh pr view --json number,url,state`) and
real code changed (`cd "$WORKDIR" && git diff main...HEAD --stat` is non-empty).
If either is missing, stop and report — do not hand-write the implementation
yourself. On pass, record it:
`python3 "$SKILL_DIR/scripts/run_state.py" set <slug> pr <number>`.

---

## Stage 4 — Simplify (`/simplify`, inline)

Invoke the `simplify` skill from `WORKDIR` (inline — it owns its three-lens
analyst fan-out). Scope is the branch diff vs `main`. The skill applies
accepted fixes itself, reruns the project's quality gates in the foreground,
and **commits + pushes only on green** — if the rerun is red it fixes or
reverts before committing.

**GATE:** working tree clean before Stage 5, with any simplify commit landed
only after a green rerun.

---

## Stage 5 — Review (`/review`, inline)

Invoke the `review` skill from `WORKDIR` (inline — it owns the persona analyst
fan-out) against this PR. Its actionable findings land as **resolvable inline
PR review threads** so Stage 6 has something to resolve. Review is read-only:
it posts threads, never pushes code.

Zero findings is a valid outcome — Stage 6 then no-ops.

**GATE:** review completed and every actionable finding is posted as a PR
thread.

---

## Stage 6 — Resolve review feedback (`/resolve-review`, inline)

Invoke the `resolve-review` skill from `WORKDIR` (inline) for this PR. It
judges every unresolved thread centrally (Stage 5's findings plus any
human/bot comments that arrived), fixes the valid ones in `WORKDIR`, commits +
pushes on green gates, then replies and resolves each thread.

**GATE:** no unresolved review threads remain except ones it explicitly tagged
`needs-human`. Surface any `needs-human` threads in the final report; they do
not block the merge unless they flag a correctness risk — use judgment.

---

## Stage 7 — Babysit the PR to green (`/babysit`, inline)

Invoke the `babysit` skill from `WORKDIR` (inline) for this PR: it resolves
clear merge conflicts, triages late comments, and fixes in-scope CI failures
in a bounded loop — the bounds and guardrails are babysit's own. It never
merges.

Give it the verdict machinery — `ci_verdict.py` is the **only CI truth
source** on this host (typed check-runs API; verdict semantics in
`references/ci-and-merge.md`, host caveats in `references/environment.md`).
Capture the head SHA (`HEAD_SHA=$(cd "$WORKDIR" && git rev-parse HEAD)`),
recapturing it after every push, and poll:

```bash
python3 "$SKILL_DIR/scripts/ci_verdict.py" verdict $HEAD_SHA
```

If babysit stops short (bounds hit, out-of-scope failure, intent conflict),
append a `## CI Failures Unresolved` section to the PR body
(`gh pr edit <PR> --body-file <tmp>`), do **not** merge red, and take the
preserve path (Stage 8, `failed`).

**GATE:** the PR is green per `ci_verdict.py` for the current `HEAD_SHA`
(recorded via `run_state.py set <slug> head_sha $HEAD_SHA`), or babysit
reported a bounded stop — which is the `failed` outcome.

---

## Stage 8 — Merge and persist the outcome

**Merge (ship mode).** On green (and the Stage 6 gate satisfied), hand merge +
cleanup to the merge script from `$MAIN` — it verifies the PR body carries
`closes #N` (refusing to merge otherwise; pass `--issue <N>` so a stale
template handle cannot satisfy the gate), squash-merges pinned to the verified
`HEAD_SHA` (GitHub refuses the merge if the branch head moved after the green
verdict), and runs the merge-gated cleanup for the mode (policy rationale in
`references/ci-and-merge.md`):

```bash
python3 "$SKILL_DIR/scripts/merge_cleanup.py" merge <PR> \
  --mode <direct|worktree> --branch <type>/<slug> --head-sha $HEAD_SHA --issue <N>
```

Read its exit code precisely: **0** merged + cleaned, **1** not merged
(refused or failed — nothing deleted; take the preserve path), **2** merged but
cleanup incomplete — the PR **is** merged; do *not* report `failed` or
re-merge, finish the printed failing step manually and continue as `shipped`.

**Handoff mode (`--no-merge`).** Stop before merge. Do not delete the remote
branch, local branch, or worktree. Record the exact PR URL, head SHA, base
branch, WORKDIR, branch name, CI evidence summary, and any unresolved
`needs-human` review threads, then persist `ready-for-external-gates`.
(Passing `--no-merge` to the script performs only the `closes #N` verification
and preserves everything.)

**Preserve path (failure / any short-stop).** If any stage stopped short of the
mode's completion point, do **not** clean up: leave the local `<type>/<slug>`
branch and — in worktree mode — the `.worktrees/<slug>` working tree intact so
the user can resume/debug, and surface the worktree path + branch in the final
report. This short-stop **is** the `failed` terminal outcome.

**Persist.** Always run this half from the main checkout (`$MAIN`), never from
`WORKDIR` — by now the worktree may be removed, and persistence is independent
of execution mode. **Delegate persistence to `/project-memory`** and persist
exactly one outcome:

- **shipped** — the PR squash-merged: flip the plan's `status: active → shipped` in
  the resolved store and append the outcome — PR URL, merged SHA, and key decisions.
- **failed** — a GATE stopped short: flip the plan's `status: active → failed` in
  the resolved store and append the failing stage, the reason, and the preserved
  branch / worktree path.
- **ready-for-external-gates** — handoff mode reached green CI and intentionally
  stopped before merge: leave the plan `status: active`, append a handoff record
  with PR URL, head SHA, base branch, CI evidence summary, branch, WORKDIR, and
  the reason merge was deferred. Do not update `main`, close the issue, delete the
  branch/worktree, or mark the plan shipped/failed.
- **Edge case — failure before a plan exists.** A short-stop in Stage 0/1 has no
  plan to flip — just report `failed`.

Record the terminal outcome in the run state — **mandatory, even on
`failed`**; an outer campaign loop records a run that never persists an
`outcome` as `timeout` (hung, blocked on input, or crashed):
`python3 "$SKILL_DIR/scripts/run_state.py" set <slug> outcome
<shipped|failed|ready-for-external-gates>`.

**GATE:** the run state records `outcome`, and the work item's plan reads
exactly one of:

- `status: shipped` with PR/SHA recorded;
- `status: failed` with failing stage + reason recorded;
- `status: active` with a `ready-for-external-gates` handoff record when
  `--no-merge` intentionally deferred merge;
- or, when the run failed before a plan existed, the report states `failed`.

---

## Done

Lead with the **outcome** — `shipped`, `failed`, or
`ready-for-external-gates`; on `failed`, name the failing stage + reason. Then
report, in order: the resolved **input kind** (idea / issue / plan-file) and the
**plan path** in the resolved store; the **execution mode** (direct / worktree,
and any retained branch/worktree path); issue #N; PR URL; merged (yes + SHA, or
no with reason); CI result; any `needs-human` review threads; and memory updates
(plan status flip or handoff record).
