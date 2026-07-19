# Current compatibility contract — research findings

Ticket: [Define the compatibility contract](https://github.com/Vzlentin/dotfiles/issues/7)
Parent map: [Design the adaptive graph orchestration framework](https://github.com/Vzlentin/dotfiles/issues/4)
Branch: `research/current-compatibility-contract`

Every finding below was verified against the checked-in source (script headers
and bodies, skill files, agent definitions, tests, README, and git history) on
`origin/main` at `9b81698`. Where a contract is pinned by a test, the test is
named. Domain terms follow root `CONTEXT.md` (Campaign, Work Item, Work Graph,
Actor Graph, Actor Role, Actor Program, Actor Attempt, Graph Revision, Human
Gate, Supervisor).

Classification legend:

- **preserve** — durable behavior a strangler migration must keep (possibly
  re-homed behind a new mechanism).
- **adapt** — an accidental mechanism whose *behavior* survives but whose
  *mechanism* is bridged, then replaced, during the migration.
- **retire** — an accidental mechanism with no durable behavior worth carrying.

---

## 1. The campaign loop — `.local/bin/campaign`

The campaign loop is today's proto-Supervisor: a 200-line bash script that
drains a hand-maintained queue serially through `/go`, one herdr pane per unit.

### Durable behavior (preserve)

1. **The queue is operator-authored and never rewritten by the machine.**
   `queue` is a hand-maintained text file (one unit per line, `#` comments and
   blank lines skipped); the loop re-reads it every iteration, so mid-campaign
   edits are honored. This is the seed of the declarative Work Graph manifest:
   the operator owns the graph; the machine never mutates it.
2. **The ledger is the outcome authority and is append-only.**
   `log.jsonl` records `{ts, unit, outcome, pr, slug}` and is only ever
   appended by the loop. "Done" is defined as *shipped entry in the ledger*,
   not as absence from the queue — a Work Item's completion has an explicit
   outcome, matching the CONTEXT.md Work Item definition.
3. **Resume/retry is derived, not stored.** The next unit is the first queue
   line with no shipped ledger entry. A re-run after failure naturally retries
   the failed unit; a drained queue is a no-op exit 0. No cursor file exists
   to get out of sync.
4. **Stop-on-first-non-shipped.** The loop is serial and halts at the first
   failure/timeout, exit 1. Serial-then-halt is the safe default the first
   migration scenario must reproduce without regression (map issue #4,
   scenario 1).
5. **Failure preservation is absolute.** On any non-shipped outcome the pane
   (`go-<unit>`) is left open for debugging; nothing is torn down. On timeout
   the pane is *also* preserved — a timeout means hung / blocked-on-input /
   crashed-before-recording, and the evidence must survive.
6. **The timeout outcome is recorded, not assumed.** No fresh outcome within
   `timeout_h` (default 14h) is appended as `outcome: timeout`, so the ledger
   always tells the truth about what the Supervisor observed.
7. **Terminal-pane grace.** On `shipped` the loop sleeps 60s before
   `herdr pane close` so the agent's final report renders. Inspectability of
   the Actor Attempt's surface is deliberate, not incidental.

### Accidental mechanisms (adapt)

8. **Completion detection by polling run-state mtime.** The loop polls
   `<git-common-dir>/go-runs/<slug>.json` every 30s and accepts an `outcome`
   only when the state file is newer than a launch marker (`mktemp`), after
   clearing any stale terminal `outcome` pre-launch (`run_state.py unset`).
   This two-part freshness guard exists only because Attempts resume shared
   state files. A durable Supervisor with attempt-scoped state makes both
   guards unnecessary — but until then the strangler must keep `unset` +
   freshness semantics exactly.
9. **Unit→run matching heuristics.** Numeric units match the run-state
   `issue` field; code units (`U9a`) match a lowercase slug prefix
   (`u9a-...`). This string-matching is the entire Work Item ↔ Actor Attempt
   identity link. The migration needs a typed identity; the heuristic is the
   compatibility shim until then.
10. **Campaign config as `key=value` lines** (`plan=`, `timeout_h=`,
    `agent_cmd=`) — the seed of the declarative Campaign manifest; the
    *keys* (per-unit timeout, campaign-plan context, agent command) are real
    control-policy parameters that must survive in manifest form.
11. **`agent_cmd` runs `<cmd> "/skill:go <unit>\n<campaign context>"` in a
    pane shell that must be bash** (prompt quoted with `printf %q`). The
    multi-line prompt channel — first line is the unit, following lines are
    campaign context that never reclassifies the input — is a real contract
    with `/go` Stage 0; the bash/quoting mechanics are adapter detail.
12. **Vault resolution by env-then-`.env` scraping** (`sed` over
    `$REPO/.env`), hard error when absent ("campaigns are a vault-mode
    feature ... a clear error, not a fallback"). The fail-closed posture is
    durable; the sed-parsing is not.
13. **Project resolution by case-insensitive repo-basename match against
    `Projects/*`** — shared with project-memory; keep the rule, re-home it in
    the Supervisor's repo registration.

### Retirement candidates

14. **`herdr` CLI shape as the Supervisor's launch API** —
    `herdr pane split --current --direction right --cwd "$REPO"` → parse
    `.result.pane.pane_id` from JSON; `rename`; `run`; `close`. This is the
    pi/herdr adapter surface; per map issue #4, pi/herdr is the *initial*
    production adapter and portability lives at the seam. Nothing else in the
    system should learn this shape.
15. **Bash as the Supervisor's implementation language.** The loop's
    behavior contracts (1–7) are portable; the bash+jq+`set -euo pipefail`
    substrate is not.

---

## 2. The `/go` pipeline — `.agents/skills/go/SKILL.md`

`/go` is today's Actor Graph, executed inline by one orchestrating session
with delegated stage skills. Its stages are Actor Roles; its stage briefs are
Actor Programs; each stage run is an Actor Attempt.

### Durable behavior (preserve)

16. **Exactly one terminal outcome per run, always persisted.**
    `shipped` | `failed` | `ready-for-external-gates` (handoff mode). A
    short-stopping GATE *is* `failed` and routes to Stage 8 persistence. The
    run state records `outcome` **even on failure** — an outer Supervisor
    treats a missing outcome as timeout/crash, never as success. This is the
    core Attempt outcome contract.
17. **`issue` and `outcome` are mandatory run-state keys** — the explicit
    contract an outer loop reads to advance. Any new Attempt-state schema
    must carry equivalents.
18. **Gate discipline: never paper over a failed stage.** Each stage ends in
    a GATE; a stage that did not do its job stops the pipeline. `/go` never
    runs implementation, review resolution, or CI remediation itself, and
    never through a mechanism that hides them — hands-on work stays in a
    first-class, inspectable worker.
19. **Verify durable artifacts from authoritative sources, not rendered
    output.** After the synchronous implementer launch, Stage 3 checks the PR
    exists via `gh pr view` and the diff via `git diff main...HEAD --stat` —
    the child's chat output is never parsed as the result contract.
20. **Resume-by-reading-state.** `<git-common-dir>/go-runs/<slug>.json` is
    one flat JSON dict per run, under the git common dir — **private by
    construction** (inside `.git`, untracked) and **shared between the main
    checkout and every worktree**. Resume is `get`, never `init --force`
    (which wipes PR/branch/worktree). `init` without `--force` refuses an
    existing slug (test: `test_run_state_init_refuses_collision_without_force`).
21. **Input classification order**: plan-file → issue (`#N`, number, or
    roadmap code) → idea; first match wins; ambiguity (nonexistent `.md`
    path, unresolvable number) stops and asks — an early Human Gate.
    Campaign context lines never change classification.
22. **Guaranteed backing issue with public-safe body.** Every run produces a
    PR carrying `closes #N`; the issue body is a public-safe summary (the
    full plan stays in the plan store). No duplicate issue when one exists.
23. **Quality gates are the project's own** — discovered from the target
    repo's `AGENTS.md`/CI; there is no separate config layer. Gates run in
    the foreground; commit/push only on green.
24. **Public-repo hygiene binds every stage**: no client names, partners, or
    private commercial context in commits, PR title/body, or issue comments.
25. **Squash-only merge with `closes #N`**, so issue close and roadmap status
    update for free.
26. **Handoff mode (`--no-merge`)**: full pipeline through green CI, then
    preserve branch/worktree/PR, record `ready-for-external-gates` with PR
    URL, head SHA, base, WORKDIR, branch, CI evidence, and unresolved
    `needs-human` threads. This is the fourth outcome that already models "an
    outer gate owns merge" — direct precedent for Human Gates / external
    gates in the new control plane. All safety gates still apply; only the
    post-green merge is deferred.
27. **Babysit stop transparency**: a bounded stop appends a `## Babysit Stop`
    section to the PR body with the exact category and failing state —
    failure state is surfaced on the durable public artifact, not just the
    ephemeral session.
28. **`needs-human` thread semantics**: explicitly tagged threads stay
    unresolved with the required decision recorded; they don't block merge
    unless they flag correctness risk. This is the current Human Gate
    vocabulary.

### Accidental mechanisms (adapt)

29. **Stage sequencing as prose in a skill file.** The 8-stage DAG with its
    gates is an Actor Graph authored as markdown. Graph Revisions will need
    this as versioned structured data; until then the SKILL.md text *is* the
    graph definition and must be the regression oracle for scenario 1.
30. **Run state as flat string-valued JSON.** Keys recorded per stage:
    `classification`, `issue`, `mode`, `workdir`, `branch`, `pr`, `head_sha`,
    `outcome`. The key set is the de-facto Attempt schema — migrate it as a
    versioned record, don't redesign it blindly.
31. **Subagent launch via harness-specific recipe**
    (`references/harness/pi.md` is the only home for harness specifics; a new
    harness = one sibling file). The seam design — harness-abstract contracts
    in SKILL.md, harness specifics quarantined — is itself the durable
    pattern; the pi-subagents `subagent(...)` call shapes are adapter detail.
32. **`$SKILL_DIR`-relative script invocation** and stdlib-only ≥3.11
    scripts. The scripts are the executable truth; keep them callable during
    the whole migration (the tests pin their CLIs).
33. **Slug derivation from the artifact for branch naming** (`<type>/<slug>`)
    — keep branch naming stable so preserved branches from interrupted runs
    stay resumable across the migration boundary.

---

## 3. The run-state and verdict scripts — `scripts/`

### `run_state.py` (preserve the semantics, adapt the store)

- CLI: `init [--force]`, `set`, `unset` (idempotent; exists *because* the
  campaign loop clears stale outcomes), `get`, `list [--json]`.
- Slug validated against `[A-Za-z0-9][A-Za-z0-9._-]*` — path traversal
  rejected (test: `test_run_state_rejects_path_traversal_slug`).
- Same state path resolved from main checkout and worktree (test:
  `test_run_state_resolves_same_path_from_main_and_worktree`).
- `list --json` **skips corrupt state files** rather than failing every
  caller (test: `test_run_state_list_json_skips_corrupt_state_files`) — a
  Supervisor must never let one bad record break Campaign-wide reads.

### `ci_verdict.py` (preserve wholesale — this is the CI contract)

- Typed check-runs API is the **only CI truth source**; verdict = f(status,
  conclusion) together. Exit codes: 0 green, 1 pending, 2 failure,
  3 non-verdict. `skipped`/`neutral` are non-blocking, not red.
- **A non-verdict is never green**: empty check set, malformed JSON,
  truncated payload (`total_count` ≠ page length — a red check beyond the
  page limit must never read as green), failed `gh` call, or any crash
  (a crash exits 3, never 1/pending, which a poll loop would wait on
  forever). Tests pin every one of these (14 verdict tests).
- **Failure signature** — stable hash over sorted failed check names + first
  output line, so "same failure again" is a string comparison
  (test: `test_failure_signature_stable_across_identical_failures`). This
  feeds babysit's repeated-signature stop.

### `merge_cleanup.py` (preserve wholesale — this is the merge contract)

- Refuses merge without a `closes #N` handle; `--issue N` pins the handle so
  a stale template handle cannot satisfy the gate (tests:
  `test_merge_refuses_without_closes_handle`,
  `test_merge_refuses_close_handle_for_wrong_issue`).
- Merge pinned with `--match-head-commit <sha>`: a branch that moved after
  the green verdict refuses to merge (test:
  `test_merge_is_pinned_to_the_verified_head_sha`).
- **Trust PR state over the merge command's exit code** — `gh pr merge` can
  exit non-zero after the API merge succeeded; retry of an already-merged PR
  skips straight to cleanup (tests pin both).
- **Cleanup is merge-gated; preserve is the default.** Exit codes carry
  meaning: 0 merged+cleaned, 1 not merged (nothing deleted), 2 merged but
  cleanup incomplete (the PR *is* merged; never report `failed`, never
  re-merge). Tests pin each.
- Worktree removal is deliberately **not** forced: uncommitted work refuses
  the removal instead of being destroyed (test:
  `test_dirty_worktree_refuses_removal_without_force`).
- Worktree-mode cleanup never runs `git checkout`/`git pull` in the user's
  checkout; local `main` is fast-forwarded via `git fetch origin main:main`,
  skipped when the user sits on `main` (tests pin both).
- Local branch delete is always `-D` (a squash-merged branch never shows as
  merged to git); remote delete is best-effort warn-only.

### `provision_worktree.py` (preserve the safety semantics, adapt the config source)

- **Smart-worktree gate**: `direct` only on clean `main`; any other branch,
  detached HEAD, or dirty tree → `worktree`. The user's branch and
  uncommitted work are never disturbed — the foundational branch/worktree
  safety invariant (test: `test_decide_mode_matrix`).
- Provision cuts `.worktrees/<slug>` on a fresh `<type>/<slug>` branch from
  `origin/main`; refuses existing worktree path or branch; never mutates the
  caller checkout; aborts on the first failed setup step and prints recovery
  commands for the debris (tests pin all).
- Setup steps read dynamically from the project's `.cursor/worktrees.json`
  (`setup-worktree-unix`, `$ROOT_WORKTREE_PATH` substitution); absent config
  → plain `git worktree add`. The *project-declared setup* idea survives as a
  manifest field; the `.cursor/` filename is legacy.

---

## 4. The stage skills — `.agents/skills/{plan,implement,simplify,review,resolve-review,babysit}/`

Each is an Actor Program: standalone-invocable, with its own completion
contract. Their durable contracts:

### plan (preserve behavior, adapt store)

- **Headless-safe posture**: never block on a question when no human can
  answer; record the smallest reasonable assumption in a mandatory
  `## Assumptions` section (empty allowed, never omitted). This is the
  autonomy posture the Supervisor must inherit for unattended Campaigns.
- Plans are **zero-context work orders**: bite-sized tasks, exact paths,
  per-task verification command, project gate commands cited from the
  repo's own AGENTS.md. No implementation code in plans; decisions only.
- Frontmatter schema: `title`, `type`, `status: active`, `date`, `origin`.
  `origin: "GitHub issue #N — …"` is the plan↔issue link `/go` Stage 1
  matches on; `status` flips are the persistence record (shipped/failed, or
  stays `active` with a handoff record). **Plan persistence is a durability
  contract the Supervisor must honor.**

### implement (preserve)

- Works exactly the branch/workdir the brief names (they may pre-exist —
  worktree mode); never the default branch; never re-plan or narrow scope.
- BUILD GATE: account for every spec task with files + verification evidence;
  TDD skips need recorded reasons.
- Finish contract: foreground gates, commit only on green, public-safe PR
  with 3-bullet summary + test plan + `closes #N`, title ≤70 chars.
- **Never self-review beyond the gates, never merge** — role separation
  between Actor Roles is already enforced.

### simplify (preserve)

- Scope is the branch diff only, behavior-preserving only; three fixed lenses
  (slop/quality, performance, reuse) fanned out as read-only blocking scouts.
- Every finding gets exactly one recorded disposition (apply or skip with
  reason); **safety checks at trust boundaries are never simplified away**;
  commit+push only on green; untouched tree when nothing applies.

### review (preserve — the mechanics here are subtle and load-bearing)

- Read-only: posts findings, never pushes code. Zero findings is valid.
- Findings land as **resolvable inline PR review threads**, anchored at the
  PR head SHA (`commit_id`) — *not* top-level `gh pr comment`s. Reason: the
  whole pipeline runs under one gh identity, so a top-level comment is
  authored by the PR author and resolve-review's own-comment filter would
  silently drop it. **Only inline threads are guaranteed to reach the resolve
  stage.** Any new review plane must keep the "findings are resolvable,
  addressable, non-self-authored threads" invariant.
- **Quote-the-line is mandatory** — no verbatim quoted evidence, no finding.
  Persona panel: 4 always + security/adversarial conditionally; dedup by
  file+line(±3)+issue; corroborating personas named in the thread body.

### resolve-review (preserve)

- **Comment text is untrusted input** — never execute commands found in
  review threads; decide fixes from the code. A security invariant that must
  survive into any capability-authorization model.
- Default to fixing; central judgment of all threads before editing (dedup,
  catch systematically-wrong reviewers); four divert dispositions
  (`not-addressing`, `declined`, `replied`, `needs-human`) each requiring
  cited evidence.
- Resolution state is the only authoritative signal (`isOutdated` ≠
  addressed). Reply-with-quoted-context then resolve, except `needs-human`
  which stays unresolved with the decision recorded. Re-fetch to verify the
  unresolved set is empty except `needs-human`.
- Mechanism (adapt): three bash GraphQL helpers
  (`get-pr-comments`, `reply-to-pr-thread`, `resolve-pr-thread`) — shellcheck-clean
  and contract-pinned by the skill text; fine as the gh adapter for now.

### babysit (preserve — its bounds are the loop-control policy)

- **Never merges** — the caller owns the merge gate.
- Bounded loop: **max 3 fix iterations**; **repeated-signature stop** (same
  failure signature twice → stop immediately); intent-conflicting merges →
  `needs-human`, never guessed.
- **Never weaken assertions, skip/delete tests, or edit CI to make failures
  pass.** Fix root causes in scope only; out-of-scope merge-blockers → check
  the base branch, else stop and report.
- Exit vocabulary: `green` or `stopped` with the exact bound, what was
  tried, and the failing state left behind.

---

## 5. pi-subagents and the harness recipe — `.agents/agents/`, `references/harness/pi.md`

### Durable behavior (preserve)

- **Sync, blocking, zero-polling delegation.** All agents are `async: false`;
  a batch containing any sync child barriers until all finish, and each
  child's final message returns as the tool result. The orchestrator never
  polls child status. (Pinned by `test_agent_definitions_pin_the_pipeline_contract`.)
- **Inspectable interactive workers.** `implementer` and `hands` are
  `mode: interactive`, `auto-exit: true`, `trust-project: true` — the child
  loads the project's AGENTS.md and skills, runs in a visible pane, and its
  surface stays inspectable until the sync launch returns. The documented
  background fallback is explicitly costlier: pi-subagents runs background
  children with `--no-approve`, which drops `trust-project` — so
  inspectability and project-trust are coupled, and the recipe says to fix
  the surface rather than fall back.
- **Read-only scouts by contract, not fully by construction.** `scout` is
  background, `deny-tools: edit,write` — but bash remains for `git diff`/`gh`
  inspection, so the non-mutating instruction text carries the rest. The
  capability-based authorization plane should make this structural; today's
  mix (tool deny-list + prompt discipline) is the baseline guarantee.
- **One scout agent, personas arrive in the task text.** Identity via
  pasted persona files, not per-persona agent definitions — Actor Role vs.
  Actor Program separation already exists in embryo.
- **Model routing lives in agent profiles, not in the pipeline.** `/go` names
  roles; profiles own model/thinking (`hands` pinned Luna xhigh, `scout`
  Terra low, `worker` Kimi K3 high with `allow-model-override: false`;
  `implementer` inherits from the parent). Pinned by
  `test_worker_agent_is_full_capability_kimi_generalist`.
- **`cwd` is always passed explicitly** — never assume inheritance in
  worktree mode.

### Accidental mechanisms (adapt)

- Mux auto-detection (`PI_SUBAGENT_MUX` unset → herdr/cmux/tmux/zellij/
  WezTerm); the labelled-tab surface under herdr.
- The `subagent(...)` tool-call shapes and `name`/`title` conventions —
  pi-adapter specifics behind the harness-recipe seam.

---

## 6. herdr panes

- Panes are the **operator's inspection surface and the failure
  evidence store**: named `go-<unit>`, preserved on any non-shipped outcome,
  closed only after a shipped run's 60s grace. Inspectability-after-failure
  is a hard operator affordance (preserve).
- The pane lifecycle CLI (`split`/`rename`/`run`/`close`, JSON result
  parsing) and the bash-shell requirement are pi/herdr-adapter mechanics
  (adapt; retire beyond the adapter seam).
- **Fog**: panes are ephemeral terminal surfaces. The decided product
  boundary (local web control room, private traces local by default) needs
  durable Attempt traces; how pane content becomes a captured trace is
  undecided.

---

## 7. project-memory integration — `.agents/skills/project-memory/SKILL.md`

### Durable behavior (preserve)

- **Single resolution point.** All store-location logic lives here; callers
  delegate rather than hardcoding paths. One resolver, one skip rule.
- **Degrade gracefully, by surface, and fail closed on privacy.**
  Plans (work orders, public-safe) fall back to repo `docs/plans/`. Durable
  memory (`architecture.md`, `vision.md`, `lessons.md`, `CONCEPTS.md`,
  `deferred-findings-register.md`, `solutions/`) is **skipped entirely** when
  no vault — never invented, never written to a possibly-public repo. This
  is the privacy contract in executable form.
- **No absolute vault paths committed anywhere.**
- Project identity: repo dir name matched case-insensitively against
  `Projects/*`, created on first write.
- **Plan-status persistence is the outcome record**: `active → shipped`
  (with PR URL, merged SHA, key decisions) or `active → failed` (with
  failing stage, reason, preserved branch/worktree); handoff leaves
  `active` + a handoff record. The vault is its own git repo, committed on
  update, pushed only if a remote exists.
- **Append-only registers**: `lessons.md` and the deferred-findings register
  are append-only; the register is never recreated, reordered, or rescoped.
- Relocation dance for vault mode: write repo copy → rewrite frontmatter →
  write vault → verify → delete repo copy. One source of truth, no private
  context left in the repo.

### Accidental mechanisms (adapt)

- The write-to-repo-then-relocate dance exists only because planning skills
  author into `docs/plans/` first; a declared plan store could write directly.
- `OBSIDIAN_VAULT_PATH` from shell env, then `.env` scraping — becomes a
  manifest-declared memory binding. The check-`.env`-before-concluding-absent
  rule is a real behavior (harnesses load `.env` unevenly).
- `campaigns/<name>/` living inside the vault project folder — a reasonable
  default the Supervisor's storage decision may re-home; the *format*
  (queue + config + ledger) is the contract.

---

## 8. Install and public-repo conventions — `install.sh`, `.gitignore`, tests

### Durable behavior (preserve)

- **`install.sh` is idempotent and never destructive**: existing correct
  links left alone; anything in the way moved to `<path>.pre-dotfiles`,
  never deleted. Whole-dir symlink for `~/.agents` (harnesses walk it);
  per-file for everything else so untracked runtime state can't land in the
  repo. Dangling agent links retired while user-owned/CLI-managed agents are
  preserved.
- **Default-deny `.gitignore` allowlist.** Nothing tracked unless explicitly
  listed; config dirs allowlist individual files, never whole dirs; a new
  tracked skill needs its own entry. This is the public-repo privacy
  enforcement layer — tokens, auth, and runtime state can't be committed by
  accident.
- **The test suite *is* the executable compatibility contract.**
  `tests/test_go_scripts.py` (~60 tests) pins: script CLIs and exit codes,
  verdict semantics, merge-refusal/cleanup paths, worktree safety, run-state
  roundtrips and collision refusal, agent-definition frontmatter flags
  (`async: false`, `auto-exit`, `deny-tools`, `trust-project`, model
  routing), harness isolation (pi specifics only in `references/harness/pi.md`),
  stage-skill invocation/completion contracts, and the single global skill
  discovery path. CI runs pytest on Ubuntu **and Windows**, plus ruff and
  shellcheck. A strangler migration keeps this suite green at every step —
  it is the scenario-1 regression oracle in CI form.
- Script conventions: stdlib-only Python ≥3.11 with docstring headers;
  shellcheck-clean bash with comment headers; headers kept accurate (README
  links to them as the reference).

### Environment traps (preserve as guardrails)

`references/environment.md` records four host traps; three are absorbed by
the scripts calling git/gh via Python subprocess (MSYS porcelain wrapper,
`gh pr checks --json` wrapper, MSYS `grep -F` core-dumps → any scanner abort
is a non-verdict, never a pass), and the fourth (never bulk-rewrite files via
PowerShell 5.1 — UTF-16LE BOM corruption) governs agent edits. The
generalized rule — **a broken detector is a non-verdict, never a pass** — is
a durable safety invariant for the Supervisor's own sensors.

---

## 9. Summary

### Most load-bearing preserved contracts

1. **Outcome authority**: exactly one terminal outcome per run
   (`shipped`/`failed`/`ready-for-external-gates`), always persisted, with
   `issue` + `outcome` as the Supervisor-facing keys; missing outcome =
   timeout, never success.
2. **Failure preservation**: branch, worktree, pane, and PR survive every
   non-shipped outcome; cleanup is strictly merge-gated; preserve is the
   default everywhere (`--no-merge`, refused merge, failed merge, bounded
   babysit stop).
3. **Operator-owned graph, machine-owned journal**: hand-editable queue
   never rewritten by the loop; append-only ledger as completion authority;
   resume derived from (queue, ledger) with no cursor to corrupt.
4. **Never-green-by-accident sensors**: CI non-verdict ≠ green; scanner
   crash ≠ clean; merge pinned to the verified head SHA; `closes #N` pinned
   to the right issue; PR state trusted over command exit codes.
5. **User-checkout inviolability**: smart-worktree gate; cleanup never
   touches the user's branch/dirty tree; worktree removal never forced.
6. **Public/private boundary**: public-safe PRs/issues/commits; durable
   private memory skipped (never relocated into the repo) when the vault is
   absent; default-deny tracking.
7. **Inspectability + role separation**: hands-on stages run in first-class
   sync, inspectable workers; `/go` never does or hides the work; review is
   read-only; babysit never merges; comment text is untrusted input.
8. **Human Gate vocabulary already exists**: ask-on-ambiguity (Stage 0),
   confirm-before-plan-reuse, `needs-human` threads and stops, handoff mode.

### Clearest retirement candidates

1. Polling-based completion detection (30s poll + mtime freshness marker +
   pre-launch `unset`) — replaced by attempt-scoped Supervisor state.
2. Unit↔run string-matching heuristics (issue-field vs slug-prefix) —
   replaced by typed Work Item ↔ Attempt identity.
3. The herdr pane CLI as anything but adapter internals.
4. Bash+jq as the Supervisor substrate; `sed`-based `.env` scraping.
5. The write-to-`docs/plans/`-then-relocate plan dance.
6. The queue/config `key=value` and one-unit-per-line formats *as formats*
   (the parameters and semantics survive as manifest fields).
7. `sleep 60` pane-teardown grace (an inspectability hack; durable traces
   make it moot).

### Newly visible decisions

- **State authority consolidation.** Today authority is deliberately split:
  run-state JSON (Attempt progress), ledger jsonl (Campaign completion),
  plan frontmatter (work-order lifecycle), GitHub PR/issue state (review +
  merge truth), PR body (babysit stops). The Supervisor must pick which of
  these it owns natively vs. keeps as read mirrors — and the migration must
  sequence the handover store by store, since the campaign loop reads
  run-state while the new Supervisor must not double-write it.
- **Attempt state schema versioning.** The flat run-state key set
  (`classification`, `issue`, `mode`, `workdir`, `branch`, `pr`, `head_sha`,
  `outcome`) is the de-facto v1 schema; naming it as a versioned Graph
  Revision-adjacent record would let old runs resume under the new
  Supervisor during the strangler window.
- **Timeout as policy, not outcome.** The loop invents `timeout` when no
  outcome appears; the new model likely wants distinct Attempt lifecycle
  states (hung / blocked-on-input / crashed-before-recording) with timeout
  as Supervisor-side control policy.
- **Outcome enum.** `ready-for-external-gates` already proves the outcome
  set is open; the new control plane should treat the terminal-outcome enum
  as versioned and extensible rather than boolean shipped/failed.

### Fog

- **Supervisor store location**: per-repo under `.git` (today's
  private-by-construction trick) vs. a global local store keyed by repo
  registration. The trick works because git-common-dir is shared with
  worktrees; a global store must reproduce that sharing story.
- **Pane → durable trace capture**: how interactive-pane content becomes the
  control room's private local traces.
- **Import path**: whether existing campaign dirs (queue + config + ledger)
  and `go-runs/*.json` get a one-shot import into Work Graph manifests and
  the Supervisor journal, or are handled by the compatibility shim until
  they drain.
- **How much of the stage-skill prose becomes structured Actor Graph data**
  vs. stays as Actor Program text referenced by graph nodes — the Graph
  Revision mechanism only needs the former versioned.
