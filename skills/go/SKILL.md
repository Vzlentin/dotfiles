---
name: go
description: Implementation-orchestration pipeline. Given a plain idea, a GitHub issue (#N / number / roadmap code), or a path to a plan file, drive it end-to-end to a merged PR with persisted outcome.
---

You are running the implementation-orchestration pipeline for the work item in
`$ARGUMENTS`. Execute the stages **in order**. By default, every run ends in
exactly one **terminal outcome** — `shipped` (PR squash-merged) or `failed` (a
stage stopped short) — persisted to the plan store by Stage 6.

Each stage ends in a **GATE**: if the stage did not do its job, stop — do not
paper over a failed stage to reach the next one. A short-stopping GATE **is** the
`failed` outcome: it routes to Stage 6 to persist `failed` (when a plan already
exists), then reports.

`/go` accepts three input kinds — a **plain idea**, a **GitHub issue** (`#N`,
number, or roadmap code like `U3`), or a **path to a plan file**. It resolves the
input to a concrete plan in the store resolved by `/project-memory` (the vault,
or the `docs/plans/` fallback; invoking `/ce-plan` when none exists), guarantees
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

Parse `$ARGUMENTS` before Stage 0a:

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
instructions from an outer loop (a campaign-plan reference, execution-log
maintenance, routing reminders). Honor them at the stage they address (e.g.
log appends at Stage 6), but they never change the Stage 0a input
classification, and a referenced campaign plan is planning *input*, never the
unit's resolved plan (Stage 0b still makes a unit plan).

## Project rules that bind every stage

- **Read the project's rules first.** The target repo's `AGENTS.md` (or
  equivalent agent instructions) and `.agents/config.toml` carry the project's
  quality gates, guardrails, frozen baselines, and routing examples. They bind
  every stage of this run.
- **Project config.** `<repo>/.agents/config.toml` supplies what the scripts
  and gates need deterministically, in a `[go]` table:

  ```toml
  [go]
  quality_gates = ["uv run ruff check .", "uv run pytest"]
  setup_check = "uv run python -c 'import mypackage'"
  ```

  - `quality_gates` — the list of gate commands (lint, type check, tests) run
    before any commit lands.
  - `setup_check` — a command that proves a provisioned environment works.
  A missing config means generic defaults: no setup check, and quality gates
  discovered from the project's own docs/CI.
- **Storage is delegated.** The plan store and outcome persistence are resolved by
  `/project-memory`.
- **Public repo, private context stays out.** Assume the target repo is public.
  No client names, partners, or private commercial context in commit messages,
  the PR title/body, or issue comments.
- **Squash + `closes #N`.** Merge is squash-only; the PR body must carry
  `closes #N` so the issue closes and roadmap status updates for free.

---

## Invocation model

Each stage delegates to a skill-primitive; how it's invoked depends on who owns
the fan-out:

- **Subagent (fresh context window):** invoke the `ce-work` skill inside a normal
  implementation-capable subagent — `ce-work` is a skill, not a required
  `subagent_type` / tool name.
- **Inline (the `/go` agent runs it directly):** `ce-plan`, `ce-simplify-code`,
  `ce-code-review`, `ce-resolve-pr-feedback`. `ce-plan` runs inline so its
  clarifying gates can reach you (a subagent can't ask questions); the others
  each fan out their own subagents, so `/go` runs them itself to own that
  fan-out rather than nest it inside another subagent.

---

## Model routing

`/go` routes work between the frontier main model and the cheap `sidekick`
omp task agent (pinned in machine config — `~/.omp/agent/agents/sidekick.md`,
not committed to any repo), with the `slow` model role as the escalation tier
and the bundled read-only `explore` agent (on the `smol` role) for recon, per
the Fusion sidekick pattern: the main agent delegates and monitors, reads only
what it needs to decide, and keeps the plan, interpretation of ambiguity, and
final review for itself.

The main agent runs at its configured frontier effort; this section is the
steering policy for that delegator — the routing table below is the
*what-goes-where*.

**Routing classifier.** At Stage 0a, classify the work item — and re-check
per stage. A pre-assigned **`route:mechanical` / `route:judgment` label on the
backing issue wins outright** — read it before classifying yourself. Without a
label, classify on these signals:

- **Mechanical** (→ `sidekick`): promotion/evidence PRs, receipts and
  execution-log updates, carve-out/config edits, data plumbing, applying an
  already-specified fix, CI log retrieval.
- **Judgment** (→ frontier, inherit): new spec-conformance derivation, design
  of verification artifacts, gate/clock semantics, trust boundaries and
  validators, refusal matrices, anything interpreting the project's spec or
  touching surfaces the project declares frozen.

**Default to judgment.** The misroute costs are asymmetric: judgment work sent
to the sidekick costs a full rejected implementation cycle plus a locked-gate
rerun; mechanical work sent to the frontier costs only tokens. Route
implementation to the sidekick only when the item **clearly** matches a
mechanical shape; anything ambiguous or mixed-signal inherits the frontier.

A mixed item routes its implementation by the dominant signal and its
mechanical satellites (receipts, CI babysit, log updates) to the sidekick
regardless.

**Persistent sidekick.** Spawn one `sidekick` thread at the start of the run
and send it subsequent sequential tasks rather than spawning fresh agents —
its warm context is the cost saving. Fresh spawns only for parallel fan-out
or one-off isolation. Verified mechanics (2026-07-15): spawn the persistent
sidekick once via the `task` tool with a stable `name: sidekick` and
`agent: sidekick`, never `isolated: true` — isolated agents are torn down at
completion and are not revivable, so only throwaway one-off spawns may
isolate. Reuse it sequentially with an `irc` DM to the named agent: a
finished spawn goes `idle`, parks after `task.agentIdleTtlMs` (default
7 min), and a DM revives it with context intact. Block on completion with
the `job` tool, interrupt with `job cancel`, and list the roster with
`irc`. When omp-internal collab is unavailable,
cross-process orchestration falls back to herdr pane primitives
(`herdr pane split/run/send-keys/read`,
`herdr wait agent-status <pane> --status done`).

**Escalation ladder.** The sidekick gets one self-retry per failure; on a
second failure, an `ESCALATE:` return, or a repeated failure signature, move
the task to the `slow` role — or take it over inline when judgment is the
blocker — then demote remaining mechanical work back to the sidekick.

**Delegation discipline.** After delegating, block on the agent's terminal
completion via the `job` tool; never busy-poll or repeatedly inspect
partial output — polling burns frontier tokens and defeats the cost purpose
of delegation.

**Guardrail.** Routing never relaxes a gate: the project's locked quality
gates, frozen baselines, and discipline rules (read from its AGENTS.md) bind
identically for every model; escalation re-runs never skip gates; Stage 3
review is frontier-only, never routed down.

Per-stage routing:

| Stage | Route |
|---|---|
| 0a–0c classify/plan/issue | main agent inline (plan + ambiguity territory) |
| 0d provisioning | sidekick |
| 1 implement | by classification: routine → ce-work subagent on `sidekick`; judgment → inherit frontier |
| 2 simplify | inline as today; its fan-out subagents use `sidekick` |
| 3 review | frontier only, never routed down |
| 4 resolve feedback | validity verdicts stay with the main agent; accepted fixes execute on the sidekick |
| 5 CI loop | sidekick babysits (poll checks, pull failed logs, mechanical fixes); escalate on repeated signature or non-mechanical root cause |
| 6 persist | sidekick for mechanical vault/log writes; main agent owns the GATE check |

---

## Stage 0a— Classify the input

Classify the work-item input (after removing `--no-merge`, if present) into one
of three kinds, in this order — first match wins:

1. **Plan-file** — `$ARGUMENTS` resolves to an existing `.md` file (e.g.
   `2026-06-06-001-feat-foo-plan.md`). Open it and check it is an
   *executable plan* — it has implementation units / phases (`### U1`,
   `## Implementation units`, etc.). A brainstorm/ideation doc with no
   implementation units is **not** executable: carry it as a planning seed for
   Stage 0b to turn into a plan via `/ce-plan`.
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
it as they land (`classification` at 0a; `issue` at 0c; `mode`, `workdir`,
`branch` at 0d; `pr` at 1; `head_sha` at 5; `outcome` at 6), so a new session
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

Classify the work item on the Model routing signals (mechanical vs judgment —
a `route:*` label on the issue wins; default to judgment when ambiguous) and
record it (`run_state.py set <slug> classification <value>`) — Stage 1 spawns
its implementation agent on it.

**GATE:** the input resolved to exactly one of {plan-file, issue, idea}. If it is
ambiguous — a `.md` path that does not exist, or a number/code that resolves to
no issue — stop and ask.

---

## Stage 0b — Ensure a plan exists

- **Plan-file (executable):** that file is the plan — skip to Stage 0c.
- **Issue / Idea / brainstorm (or non-executable plan-file):** find an existing
  plan in the resolved store, else create one via `/ce-plan`:
  - **Issue:** search the plan store for a plan whose `origin:` or body
    references `#N`. If found, use it; else seed `/ce-plan` with the issue title
    + body.
  - **Idea / brainstorm:** keyword/slug search plan titles + filenames. On a
    *plausible* match, **confirm with the user before reusing** (a wrong reuse is
    worse than a fresh plan); on no match, seed `/ce-plan` with the idea text /
    the brainstorm's full contents. A brainstorm is **never** executable on its
    own and is **never** fed to Stage 1 as the spec — it must become a plan first.

**Invoking `/ce-plan`.** Always run `/ce-plan` **inline** so its
scoping/clarifying gates reach you (a spawned subagent can't ask questions). At
its post-generation menu pick **"Done for now"** so `/go` keeps control of issue
creation + implementation — do **not** let it start `ce-work` or create the
issue itself.

`/ce-plan` writes to `docs/plans/YYYY-MM-DD-NNN-<type>-<name>-plan.md`;
**`/project-memory` places it at the resolved store** — relocated into the vault
in vault mode, left in `docs/plans/` in fallback mode. Delegate placement there
rather than moving files here.

**GATE:** a plan file for this work item exists in the resolved store. If
`/ce-plan` produced nothing, stop and report.

---

## Stage 0c — Ensure a backing GitHub issue

Every run opens a PR that carries `closes #N`; in ship mode that merge closes the
issue, and in handoff mode the close-handle remains ready for the outer merge
workflow. Guarantee an issue exists:

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

**GATE:** a usable `#N` exists, recorded on the plan **and** in the run state
(`issue` key). If issue creation failed, stop and report.

---

## Stage 0d — Choose execution location and provision

Stages 1–5 run against a working directory `WORKDIR`, picked with a smart-worktree
gate so the user's current checkout — their branch *and* any uncommitted work —
is never disturbed. Both the mode decision and the provisioning are owned by
`$SKILL_DIR/scripts/provision_worktree.py` (rationale and caveats in
`references/worktree-provisioning.md`). From the main checkout:

```bash
python3 "$SKILL_DIR/scripts/provision_worktree.py" decide
```

prints `{"mode": "direct"|"worktree", "main": <MAIN path>}`:

- **`direct`** (on `main` AND clean): `WORKTREE_MODE=false`, `WORKDIR="$MAIN"`.
  No provisioning — `ce-work` branches inside this checkout.
- **`worktree`** (any other branch, detached HEAD, or dirty tree):
  `WORKTREE_MODE=true`. Provision an isolated worktree on a fresh branch cut
  from `origin/main`, so neither the user's branch nor their dirty tree moves —
  `<type>` is the kind `ce-work` would choose, `<slug>` is the Stage 0a slug:

```bash
python3 "$SKILL_DIR/scripts/provision_worktree.py" provision <type>/<slug>
```

The script reads the setup steps dynamically from the project's
`.cursor/worktrees.json` when present (absent config → plain
`git worktree add`, no setup steps), aborts on the first failed step, refuses
an existing worktree/branch collision, never mutates the caller checkout, and
runs the project's setup check (the `setup_check` command from
`.agents/config.toml`, when configured) itself. On success it prints
`{"workdir": <absolute path>, "branch": <type>/<slug>}` — take `WORKDIR` from
the `workdir` field. On a failure after the worktree was created, it prints
the recovery commands for the debris; run them before retrying.

`WORKDIR` is where Stages 1–5 operate. From here on, every shell command for those
stages uses an explicit `cd "$WORKDIR" && …` in worktree mode (a
`working_directory` arg can silently target the main repo); in direct mode the
`cd` is a harmless no-op. Stage 6 is the exception — it always runs from `$MAIN`.

Record the decision in the run state:

```bash
python3 "$SKILL_DIR/scripts/run_state.py" set <slug> mode <direct|worktree>
python3 "$SKILL_DIR/scripts/run_state.py" set <slug> workdir "$WORKDIR"
python3 "$SKILL_DIR/scripts/run_state.py" set <slug> branch <type>/<slug>
```

**GATE (worktree mode):** `provision` exited 0 — that exit code *is* the
worktree + setup check. If it exited non-zero, stop and report — do **not**
fall back to mutating the user's dirty checkout. In direct mode this gate is
automatically satisfied.

---

## Stage 1 — Implement + open the PR

Spawn **one** implementation-capable agent (foreground, model per the Stage 0a
routing classification — routine work on the `sidekick` agent, judgment-heavy
work inheriting the frontier model) to implement the plan and open the PR — a
subagent per the Invocation model, instructed to follow `ce-work`. The brief
authorizes it to delegate internally per the same Fusion policy (mechanical
sub-steps to `sidekick`/`explore`, judgment kept to itself) — this nesting is
what omp's `task.maxRecursionDepth` gate bounds. Give it the brief in
`$SKILL_DIR/references/ce-work-brief.md` (mode-specific setup clauses, the
project's quality gates, the private-context guard, the `closes #N` PR
finish), filling in `#N`, `<type>/<slug>`, `<WORKDIR>`, and the **pasted**
plan path.

When the agent returns, sync by mode — never move the main checkout onto the PR
branch in worktree mode:

- **Direct mode:** the agent branched in this checkout — check out the PR branch
  here and fast-forward:

```bash
gh pr checkout <PR>
git pull --ff-only
```

- **Worktree mode:** leave the main checkout where the user left it (their branch
  / dirty tree). The worktree is already on `<type>/<slug>`; just fast-forward it:

```bash
cd "$WORKDIR" && git pull --ff-only
```

**GATE:** a PR exists for this branch (`gh pr view --json number,url,state`) and
real code changed (`cd "$WORKDIR" && git diff main...HEAD --stat` is non-empty).
If either is missing, stop and report — do not hand-write the implementation
yourself. On pass, record it:
`python3 "$SKILL_DIR/scripts/run_state.py" set <slug> pr <number>`.

---

## Stage 2 — Simplify the diff (`ce-simplify-code`, inline)

Invoke the `ce-simplify-code` skill from `WORKDIR` (inline — see Invocation
model; it spawns its own subagents, which should use the `sidekick` agent).
Scope is the branch diff vs `main`. If it
changes anything, **rerun the quality gates in the foreground and commit + push
only on green** — do not chain the commit unconditionally after the gate, or a
simplify pass that broke a test lands anyway. The gate commands are the
project's `quality_gates` from `.agents/config.toml`:

```bash
cd "$WORKDIR" \
  && <each quality-gate command, in order> \
  && git add -A && git commit -m "refactor: simplify <slug>" && git push
```

If the rerun is red, do **not** commit — fix or revert the simplify change first.

**GATE:** working tree clean before Stage 3, with the commit landed only after a
green rerun.

---

## Stage 3 — Review the PR (`ce-code-review`, inline)

Invoke the `ce-code-review` skill from `WORKDIR` (inline — see Invocation model;
it spawns its own subagents) against this PR. Review is **frontier-only** — never
route it to the sidekick; it is the safety net for cheap-model implementation. Ensure its **actionable findings
land as inline PR review comments** (resolvable threads) so Stage 4 has something
to resolve — pass the PR and have it post comments rather than only printing a
report. If it commits safe fixes inline, **push them only after a green
foreground rerun** of the project's quality gates — never push a red tree:

```bash
cd "$WORKDIR" \
  && <each quality-gate command, in order> \
  && git push
```

Findings that become PR review threads are handed to Stage 4. Zero findings is a
valid outcome — Stage 4 then no-ops.

**GATE:** review completed; any inline-applied fixes are pushed only after a green
rerun.

---

## Stage 4 — Resolve review feedback (`ce-resolve-pr-feedback`, inline)

Invoke the `ce-resolve-pr-feedback` skill from `WORKDIR` (inline — see Invocation
model; it spawns its own subagents) for this PR. It evaluates every unresolved
thread (Stage 3's findings plus any human/bot comments that arrived), fixes the
valid ones in `WORKDIR`, commits + pushes, then replies and resolves each thread.
Thread-validity verdicts stay with the main agent; accepted fixes execute on the
`sidekick`.

**GATE:** no unresolved review threads remain except ones it explicitly tagged
`needs-human`. Surface any `needs-human` threads in the final report; they do not
block the merge unless they flag a correctness risk — use judgment.

**Capture deferred findings at deferral time (non-blocking, vault-only).** Stage 4
is the deferral **decision point**, so it is the sole place that records them. For
**each** thread it leaves `needs-human`, and each non-blocking finding it
deliberately does not fix, append **one row now** to the rolling
deferred-findings register **via `/project-memory`** (the register store
contract), so closeout is a read, not a post-hoc scrape of PR bodies + plans. Use
the register's existing `id | source | finding | disposition | suggested next
action` schema, keyed by this PR/issue #, with a disposition from the existing
vocabulary (`deferred-pre-existing` / `out-of-scope` / `named-follow-up` /
`excluded-item`). Reach the register **only** through `/project-memory`;
**vault-absent → skip the append and note it** (never write the public repo).
**Non-blocking** — it never fails this GATE or the merge.

---

## Stage 5 — Loop on CI, then squash-merge on green

Stage 5 owns an **inline CI watch-and-autofix loop** — there is no external CI
skill to delegate to. The `sidekick` babysits it: polling checks, pulling failed
logs, and applying mechanical fixes run on the sidekick thread; escalate to the
main agent on a repeated failure signature or a non-mechanical root cause.
Capture the head SHA (`HEAD_SHA=$(cd "$WORKDIR" && git rev-parse HEAD)`) and
poll the verdict script — it reads the typed check-runs API, the only reliable
CI source on this host (see `references/environment.md`), resolving the repo
slug from the working directory's git remote (so run it from `WORKDIR` or the
main checkout of the target repo):

```bash
python3 "$SKILL_DIR/scripts/ci_verdict.py" verdict $HEAD_SHA
```

Exit codes are the verdict — 0 **green**, 1 **pending**, 2 **failure**, 3
**non-verdict** — and the JSON report carries the detail:

- **pending** — keep polling, do **not** merge.
- **green** — exit the loop and proceed to the on-green steps.
- **failure** — enter the autofix branch; the report lists each failed check's
  name, conclusion, and workflow run-id, plus a stable `signature` string.
- **non-verdict** (empty check set, malformed or truncated payload, a failed
  `gh` call, or a crash in the script itself) — never green, never merge;
  re-poll or escalate.

**Autofix branch — the loop owns the cap and the stop.** For each failed run-id
in the report, pull its logs
(`python3 "$SKILL_DIR/scripts/ci_verdict.py" logs <run-id>`), find
and fix the **root cause** in `WORKDIR`, commit + push, recapture `HEAD_SHA`,
and re-poll. Bounded by:

- **Max 3 fix iterations.** After the 3rd failed cycle, stop — do not loop again.
- **Repeated-signature stop.** If the report's `signature` string is identical
  across 2+ iterations, stop immediately — re-running an unchanged failure is
  not progress. The signature hashes check names plus each failure's first
  output line, so distinct root causes can occasionally collide on a stock
  title; on a repeated signature, glance at the logs to confirm it is
  genuinely the same failure before stopping.

On either stop, append a `## CI Failures Unresolved` section to the PR body
(`gh pr edit <PR> --body-file <tmp>`), do **not** merge red, and take the
**preserve path** below.

`/go` owns the outer guardrails throughout: never weaken assertions, skip
tests, drift a baseline the project declares frozen, or make unrelated
workflow changes to turn CI green.

**On green** (and Stage 4 gate satisfied), record progress
(`python3 "$SKILL_DIR/scripts/run_state.py" set <slug> head_sha
$HEAD_SHA`, then `set <slug> pr <PR>`) and hand merge + cleanup to the merge
script — it verifies the PR body carries `closes #N` (refusing to merge
otherwise; pass `--issue <N>` so a stale template handle for a different issue
cannot satisfy the gate), squash-merges pinned to the verified `HEAD_SHA`
(GitHub refuses the merge if the branch head moved after the green verdict),
and runs the merge-gated cleanup for the mode (policy rationale in
`references/ci-and-merge.md`).

In **handoff mode** (`--no-merge`), stop here before merge. Do not delete the
remote branch, local branch, or worktree. Record the exact PR URL, head SHA, base
branch, WORKDIR, branch name, CI evidence summary, and any unresolved
`needs-human` review threads, then proceed to Stage 6 as
`ready-for-external-gates`. (Passing `--no-merge` to the script below performs
only the `closes #N` verification and preserves everything.)

In **ship mode**, from `$MAIN`:

```bash
python3 "$SKILL_DIR/scripts/merge_cleanup.py" merge <PR> \
  --mode <direct|worktree> --branch <type>/<slug> --head-sha $HEAD_SHA --issue <N>
```

**Cleanup is merge-gated** — the script runs it only after the merge is
confirmed against the PR's actual state; every pre-merge failure path preserves
the branch, worktree, and PR. Retries are idempotent: an already-merged PR
skips straight to cleanup. A squash-merged branch never shows as "merged" to
git, so the script force-deletes with `git branch -D` (not `-d`). In **direct
mode** it returns to `main`, fast-forwards, and drops the branch; in
**worktree mode** it removes the worktree (refusing, rather than destroying,
uncommitted work inside it) and drops the branch **without**
`git checkout main`/`git pull` in the main checkout — preserving the user's
branch and dirty tree is the whole point. Both modes finish by deleting the
remote branch.

Read its exit code precisely: **0** merged + cleaned, **1** not merged
(refused or failed — nothing deleted; take the preserve path), **2 merged but
cleanup incomplete** — the PR **is** merged; do *not* report `failed` or
re-merge, finish the printed failing step manually and continue to Stage 6 as
`shipped`.

**Preserve path (failure / any short-stop).** If the inline CI loop cannot get
the PR green, or any stage stopped short of the mode's completion point, do **not** clean
up: leave the local `<type>/<slug>` branch and — in worktree mode — the
`.worktrees/<slug>` working tree intact so the user can resume/debug, and surface
the worktree path + branch in the final report. This short-stop **is** the
`failed` terminal outcome — proceed to Stage 6 to persist `failed` before
reporting.

**GATE:** either:

- **Ship mode:** the PR is squash-merged **and** cleanup ran (local branch deleted
  in both modes; worktree removed in worktree mode) with `main` fast-forwarded.
- **Handoff mode:** the PR is green and preserved for external gates, with PR URL,
  head SHA, branch, and WORKDIR recorded.
- **Failure:** a clear report of why it stopped short, naming the preserved branch
  and worktree path, if any.

---

## Stage 6 — Persist outcome or handoff

Stage 6 always runs from the main checkout (`$MAIN`), never from `WORKDIR` — by now
the worktree may be removed by Stage 5 cleanup, and persistence is independent of
execution mode. Mechanical vault/log writes run on the `sidekick`; the main agent
owns the GATE check. Every landing receipt (execution log + tracker) carries a
one-line **model mix** note — e.g. `model mix: impl sidekick, review frontier,
CI sidekick, 1 escalation` — so the cost claim is checkable run-over-run.
**Delegate persistence to `/project-memory`** and persist exactly
one outcome:

- **shipped** — the PR squash-merged: flip the plan's `status: active → shipped` in
  the resolved store and append the outcome — PR URL, merged SHA, key decisions.
- **failed** — a GATE stopped short: flip the plan's `status: active → failed` in
  the resolved store and append the failing stage, the reason, and the preserved
  branch / worktree path.
- **ready-for-external-gates** — handoff mode reached green CI and intentionally
  stopped before merge: leave the plan `status: active`, append a handoff record
  with PR URL, head SHA, base branch, CI evidence summary, branch, WORKDIR, and
  the reason merge was deferred. Do not update `main`, close the issue, delete the
  branch/worktree, or mark the plan shipped/failed.
- **Edge case — failure before a plan exists.** A short-stop in Stage 0a/0b has no
  plan to flip — just report `failed`.

**Compound on `shipped` (non-blocking, vault-only).** When — and only when — the
outcome is `shipped` **and** `OBSIDIAN_VAULT_PATH` is set, capture a durable
learning routed to the **vault** solutions store (never the public repo).
`/ce-compound mode:headless` writes **three** things straight into the repo with
no suppress hook — a solution doc under `docs/solutions/<category>/`, a
newly-created repo-root `CONCEPTS.md`, and a `CLAUDE.md`/`AGENTS.md`
discoverability edit — and has zero vault awareness, so Stage 6 owns a post-run
reconciliation:

1. **Record pre-state** — which of `CLAUDE.md` / `AGENTS.md` / `CONCEPTS.md` /
   `docs/solutions/` already exist on `$MAIN`.
2. **Invoke `/ce-compound mode:headless`** — it self-gates (`Documentation
   skipped` when nothing is worth recording).
3. **Relocate** any solution doc it wrote to the vault via `/project-memory`
   (rewrite frontmatter to the vault convention, write, verify, delete the repo
   copy — the same shape as the `/ce-plan` relocation).
4. **Revert its repo-root side-edits** — `git checkout -- CLAUDE.md AGENTS.md`
   (tracked → restores committed) and `git clean -fd CONCEPTS.md docs/solutions/`
   (untracked / newly-created → `checkout` would error on these).
5. **Verify clean** — `git status --porcelain` on `$MAIN` must be empty before the
   Stage-6 GATE.

**Vault-absent ordering:** if `OBSIDIAN_VAULT_PATH` is unset/absent, **skip this
sub-step entirely — do not invoke `/ce-compound`** so no repo writes ever occur.
This fires **only on `shipped`** (never `failed` / `ready-for-external-gates`) and
is **non-blocking** — a `Documentation skipped` return or any error does **not**
fail the Stage-6 GATE.

**Finalize deferred-findings rows (non-blocking, vault-only).** If Stage 4
appended any deferred-findings rows this run, finalize them via `/project-memory`
with the terminal PR URL + merged SHA (or, on `failed`, the preserved-branch
reference), so closeout is a read of the rolling register, not a scrape.
Vault-absent → skip + note. **Non-blocking** — never fails the Stage-6 GATE.

Record the terminal outcome in the run state — **mandatory, even on
`failed`**; an outer campaign loop treats a run that ends without an `outcome`
key as crashed:
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
(plan status flip, handoff record, the compound outcome on a `shipped` run —
vault solution path / "no learning recorded" / "skipped — no vault" — plus
architecture/lessons or "skipped").
