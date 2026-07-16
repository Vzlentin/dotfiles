---
name: plan
description: Turn an idea or GitHub issue into an executable unit plan in the project-memory plan store. Headless-safe; prefers recorded assumptions over questions. Use when a work item needs a plan before implementation.
---

# plan

Produce one executable unit plan for the work item in `$ARGUMENTS` (an issue
number/body, idea text, or a brainstorm to distill) and place it in the plan
store resolved by `/project-memory`. The plan is a work order for a
**zero-context executor**: an agent that has read nothing but the plan must be
able to implement the unit without re-deriving your research.

## Posture

Headless-safe. When running non-interactively (a pipeline stage, `pi -p`, or
any context where a clarifying question cannot reach a human), never block on
a question: make the smallest reasonable assumption, record it in the plan's
`## Assumptions` section, and continue. Interactively, ask only questions that
change the shape of the work — everything else is an assumption too.

## Research first

Before writing anything, ground the plan in the actual repo:

- Read the project's `AGENTS.md` (or equivalent) for quality gates and
  conventions — the plan must cite the real gate commands.
- Locate the files the work touches; confirm paths exist. Grep for the
  patterns and helpers the implementation should reuse and name them.
- Check for an existing plan for this work item in the store (search
  `origin:` and titles for the issue number / slug) — update rather than
  duplicate.

## Plan shape

Write the plan so every task is **bite-sized** (one commit-worth of work, a
few files at most), every path is **exact** (real file paths, not "the config
module"), and every task is **verifiable** (names the command or observation
that proves it done). Frontmatter:

```markdown
---
title: <short imperative title>
type: feat|fix|refactor|chore
status: active
date: YYYY-MM-DD
origin: "GitHub issue #N — <short>"   # when a backing issue exists
---
```

Body sections, in order:

1. **Goal** — 2-4 lines: outcome and why, plus explicit non-goals when scope
   could creep.
2. **Assumptions** — every question you chose not to ask, with the answer you
   assumed. Empty section allowed, never omitted.
3. **Tasks** — numbered units. Each carries: the exact files to create/modify,
   the approach in a sentence or two, the existing pattern to mirror
   (`file:line` or a named helper), the test to add or update, and its
   verification command.
4. **Verification** — the project's own quality-gate commands, run order, and
   any end-to-end check proving the goal.

Do not write implementation code in the plan; write decisions. A plan that
says "add a `--json` flag to `list` mirroring `run_state.py`'s `cmd_list`" is
right; forty lines of Python is wrong.

## Placement

Delegate placement to `/project-memory`: vault mode relocates the plan into
the vault plan store; fallback mode leaves it in `docs/plans/`. Never hardcode
a store path here.

Finish by reporting the plan path and a one-line summary of the riskiest
assumption made.
