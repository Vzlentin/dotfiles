# Harness recipe — pi + pi-subagents

How `/go` and its stage skills launch subagents when the driver session is
**pi** with the [edxeth/pi-subagents](https://github.com/edxeth/pi-subagents)
package installed (`pi install git:github.com/edxeth/pi-subagents`). This file
is the only place harness specifics live — SKILL.md states the contracts
abstractly, and supporting another harness means adding a sibling file here.

## Agent definitions

Two named agents, canonical in the dotfiles repo at `.agents/agents/` and
symlinked by `install.sh` into `~/.pi/agent/agents/` (pi-subagents' global
discovery path; project-local `.pi/agents/` would override by name):

- **`implementer`** — `mode: interactive`, `async: false`, full tools,
  `trust-project: true` so the child loads the project's `AGENTS.md` and
  skills (`/implement` must resolve in the child). Its pane stays open and
  inspectable after completion.
- **`analyst`** — `mode: background`, `async: false`, `auto-exit: true`,
  `deny-tools: edit,write` (read-only by construction). The persona/lens
  identity arrives in the task text pasted from the calling skill's persona
  files — there is one analyst agent, not one per persona.

## Sync semantics — zero polling

Both agents are `async: false`. In pi-subagents, **a tool-call batch that
contains any sync child barriers the whole batch**: every child in the batch
launches, the parent blocks until all of them finish, and each child's final
assistant message comes back as that tool call's result. So:

- **Stage 3 (implement):** one `subagent` call for `implementer`. The call
  returns when the implementation is done. No status polling, no waits.
- **Analyst fanout (simplify's 3 lenses, review's persona panel):** issue all
  `subagent` calls for `analyst` **in one message/batch**. The batch returns
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

Analyst batch (one call per lens/persona, all in a single batch; task = the
persona/lens text pasted verbatim + scope + output contract):

```
subagent(agent: "analyst", name: "review-correctness", title: "Correctness review", cwd: "<WORKDIR>", task: "<persona + diff + contract>")
subagent(agent: "analyst", name: "review-security",    title: "Security review",    cwd: "<WORKDIR>", task: "<persona + diff + contract>")
…
```

`name` is the machine handle (lower-kebab, <=32 chars); `title` is the human
label in the widget. Pass `cwd` explicitly — never assume the child inherits
the right directory in worktree mode. For a large diff, write it to a temp
file and reference the path in the task text instead of inlining it.

## Interactive surface — mux detection and fallback

The `implementer` is `mode: interactive`: pi-subagents opens it in the
current terminal backend (herdr, cmux, tmux, zellij, or WezTerm), auto-detected
from where the parent pi runs. Leave `PI_SUBAGENT_MUX` unset for auto-detect;
set it (`herdr`, `tmux`, …) to force a backend. Under herdr the child appears
as a labelled tab in the parent workspace.

**Fallback:** if no supported mux is active, interactive launches fail with a
setup hint. Then either run the parent inside tmux/herdr, or flip the launch
to a background child (launch `implementer` with `mode: background` override
in a project-local agent file, or accept the analyst-style headless run) —
the pipeline contract (sync launch, artifacts verified from authoritative
sources) is unchanged; only inspectability is lost. Do not fall back to
implementing inline in the parent.

## Driver invocations

- A human (or the campaign loop) triggers a run with pi's skill command:
  `pi '/skill:go <unit>'` — arguments after the command are appended to the
  skill content.
- The `analyst`/`implementer` children are launched by the *orchestrating
  session* via the `subagent` tool; stage skills never shell out to `pi`
  directly.
