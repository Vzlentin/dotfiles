# Harness recipe — pi + pi-subagents

How `/go` and its stage skills launch subagents when the driver session is
**pi** with the [edxeth/pi-subagents](https://github.com/edxeth/pi-subagents)
package installed (`pi install git:github.com/edxeth/pi-subagents`). This file
is the only place harness specifics live — SKILL.md states the contracts
abstractly, and supporting another harness means adding a sibling file here.

## Agent definitions

Three named agents, canonical in the dotfiles repo at `.agents/agents/` and
symlinked by `install.sh` into `~/.pi/agent/agents/` (pi-subagents' global
discovery path; project-local `.pi/agents/` would override by name):

- **`implementer`** — interactive, sync, auto-exiting, full tools, and trusted
  for the project so the child loads its `AGENTS.md` and stage skills. It runs
  implementation and review-resolution briefs. Its pane is inspectable while
  it runs and closes after its final response. It omits `model` and `thinking`,
  so it inherits both from `/go`.
- **`hands`** — interactive, sync, auto-exiting, full tools, and trusted. It is
  the general worker for bounded mechanical procedures; its profile owns its
  execution configuration. `/go` uses it for babysitting, whose brief forbids
  merging.
- **`scout`** — background, sync, edit/write denied. Its profile owns its
  execution configuration.
  Not fully read-only by construction — bash remains available for `git
  diff`/`gh` inspection — so the agent definition's non-mutating instructions
  carry the rest. The persona/lens identity arrives in the task text pasted
  from the calling skill's persona files — there is one scout agent, not one
  per persona.

The exact frontmatter flags live in `.agents/agents/{implementer,hands,scout}.md`
— those files are the authority, and the contract test pins the load-bearing
ones (`async: false`, `auto-exit: true`, `deny-tools`, `trust-project`, and
model routing).

## Sync semantics — zero polling

All three agents are `async: false`. In pi-subagents, **a tool-call batch that
contains any sync child barriers the whole batch**: every child in the batch
launches, the parent blocks until all of them finish, and each child's final
assistant message comes back as that tool call's result. So:

- **Stages 3 and 6 (implement and resolve-review):** one `subagent` call for
  `implementer` per stage. Each call returns when that stage is done. No status
  polling, no waits.
- **Stage 7 (babysit):** one `subagent` call for `hands`. The call returns when
  babysitting reaches green or a bounded stop.
- **Scout fanout (simplify's 3 lenses, review's persona panel):** issue all
  `subagent` calls for `scout` **in one message/batch**. The batch returns
  all findings together.

## Launch shapes

Stage 3 implementer (task = the filled brief from SKILL.md Stage 3):

```
subagent(
  agent: "implementer",
  name: "go-<slug>-implement",
  title: "Implement <slug>",
  cwd: "<WORKDIR>",
  task: "<the filled implementation brief>"
)
```

Post-implementation stages (task = a self-contained brief naming the skill,
PR, WORKDIR, constraints, and result contract):

```
# Resolve-review uses the inherited implementer profile.
subagent(
  agent: "implementer",
  name: "go-<slug>-resolve",
  title: "Resolve <slug> review",
  cwd: "<WORKDIR>",
  task: """
Invoke the `resolve-review` skill (`/skill:resolve-review`) for PR <PR>.
Work only in <WORKDIR> on its existing branch; do not re-plan, merge, or start
a later pipeline stage.

Fetch every unresolved inline thread and judge all of them centrally before
editing. Fix accepted findings, run the project's quality gates in the
foreground, and commit + push only on green. Reply to and resolve every thread
except `needs-human`, which must stay unresolved with the required decision
recorded.

Report every thread disposition, commits pushed, quality-gate results, and all
remaining `needs-human` thread URLs.
"""
)

# Babysit routing is owned entirely by the hands profile.
subagent(
  agent: "hands",
  name: "go-<slug>-babysit",
  title: "Babysit <slug> CI",
  cwd: "<WORKDIR>",
  task: """
Invoke the `babysit` skill (`/skill:babysit`) for PR <PR>. Work only in
<WORKDIR> on its existing branch. Resolve clear conflicts, triage late review
threads, and fix only in-scope CI failures within the skill's bounds. Never
merge.

`ci_verdict.py` is the only CI truth source. Before each verdict capture
`HEAD_SHA=$(git rev-parse HEAD)`; recapture it after every push, then run:

    python3 "<absolute go SKILL_DIR>/scripts/ci_verdict.py" verdict $HEAD_SHA

Run project quality gates in the foreground before every push. On green,
report the final head SHA, verdict evidence, changes/commits pushed, and review
thread state. On a bounded stop, preserve the branch and report `stopped`, the
exact category and failing state, attempts made, unresolved checks, and any
`needs-human` thread URLs so the caller can update the PR body and take the
preserve path.
"""
)
```

Scout batch (one call per lens/persona, all in a single batch; task = the
persona/lens text pasted verbatim + scope + output contract):

```
subagent(agent: "scout", name: "review-correctness", title: "Correctness review", cwd: "<WORKDIR>", task: "<persona + diff + contract>")
subagent(agent: "scout", name: "review-security",    title: "Security review",    cwd: "<WORKDIR>", task: "<persona + diff + contract>")
…
```

`name` is the machine handle (lower-kebab, <=32 chars); `title` is the human
label in the widget. Pass `cwd` explicitly — never assume the child inherits
the right directory in worktree mode. For a large diff, write it to a temp
file and reference the path in the task text instead of inlining it.

## Interactive surface — mux detection and fallback

The `implementer` and `hands` agents are `mode: interactive`: pi-subagents
opens them in the current terminal backend (herdr, cmux, tmux, zellij, or
WezTerm), auto-detected from where the parent pi runs. Leave `PI_SUBAGENT_MUX`
unset for auto-detect; set it (`herdr`, `tmux`, …) to force a backend. Under
herdr the child appears as a labelled tab in the parent workspace.

**Fallback:** if no supported mux is active, interactive launches fail with a
setup hint. Prefer fixing the surface (run the parent inside tmux/herdr).
Flipping an interactive worker to a background child works but costs more
than inspectability: pi-subagents runs background children with `--no-approve`,
which drops `trust-project` — the child no longer auto-loads the project's
`AGENTS.md`, settings, or project-local skills. If you must go background,
compensate in the brief: paste the project's quality-gate commands and any
load-bearing `AGENTS.md` rules into the task text, and verify the named stage
skill still resolves (these are global skills here, so they do). The sync
launch and authoritative-artifact verification are unchanged either way. Do
not fall back to doing the hands-on stage inline in the parent.

## Driver invocations

- A human (or the campaign loop) triggers a run with pi's skill command:
  `pi '/skill:go <unit>'` — arguments after the command are appended to the
  skill content.
- The `scout`/`implementer`/`hands` children are launched by the
  *orchestrating session* via the `subagent` tool; stage skills never shell
  out to `pi` directly.
