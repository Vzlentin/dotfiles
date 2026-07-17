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

- **`implementer`** — interactive, sync, auto-exiting, full tools, and trusted
  for the project so the child loads its `AGENTS.md` and skills (`/implement`
  must resolve in the child). Its pane is inspectable while it runs and closes
  after its final response.
- **`analyst`** — background, sync, edit/write denied. Not fully read-only
  by construction — bash remains available for `git diff`/`gh` inspection —
  so the agent definition's non-mutating instructions carry the rest. The
  persona/lens identity arrives in the task text pasted from the calling
  skill's persona files — there is one analyst agent, not one per persona.

The exact frontmatter flags live in `.agents/agents/implementer.md` and
`analyst.md` — those files are the authority, and the contract test pins the
load-bearing ones (`async: false`, `auto-exit: true`, `deny-tools`,
`trust-project`).

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
setup hint. Prefer fixing the surface (run the parent inside tmux/herdr).
Flipping the implementer to a background child works but costs more than
inspectability: pi-subagents runs background children with `--no-approve`,
which drops `trust-project` — the child no longer auto-loads the project's
`AGENTS.md`, settings, or project-local skills. If you must go background,
compensate in the brief: paste the project's quality-gate commands and any
load-bearing `AGENTS.md` rules into the task text, and verify `/implement`
still resolves (it is a global skill here, so it does). The sync launch and
authoritative-artifact verification are unchanged either way. Do not fall
back to implementing inline in the parent.

## Driver invocations

- A human (or the campaign loop) triggers a run with pi's skill command:
  `pi '/skill:go <unit>'` — arguments after the command are appended to the
  skill content.
- The `analyst`/`implementer` children are launched by the *orchestrating
  session* via the `subagent` tool; stage skills never shell out to `pi`
  directly.
