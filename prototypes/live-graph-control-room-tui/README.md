# PROTOTYPE — THROWAWAY: Campaign graph control-room TUI

**This is a throwaway prototype. Do not productionize it, do not tidy it into
the repo proper, do not build on it.** It exists to answer one question for
GitHub issue #9 and will be discarded once that question is answered.

## Question

What is the smallest Herdr-hosted running-Campaign TUI that makes progress,
parallelism, graph decisions, and operator-needed work immediately legible
while keeping details behind expansion?

## Agreed scope (what this prototype models)

- Herdr hosts the program; the persistent main pane is the primary TUI
  minimap/controller. No secondary GUI.
- Starts directly inside one already-confirmed running Campaign. Wayfinder
  authoring and candidate confirmation are out of scope.
- The Work Graph is one hierarchical, versioned DAG. Campaign-level nodes are
  first-class Wayfinder Decisions and compound Work Items; each owns an Actor
  Graph and expands **in graph context** (inline, never a side panel).
- A Decision resolves through a Wayfinder Actor Graph (research, prototype,
  grilling, task); a Work Item uses the logical `/go` Actor Graph.
- Actor Nodes are logical responsibilities, whether an Attempt runs inline or
  in a child process. Plans are attached artifacts, never graph nodes.
- The Supervisor drains the takeable frontier automatically; the minimap is a
  navigator and launcher/focus surface, not a dashboard. Selecting running
  work shows a stubbed "would focus Herdr pane" message only.
- Operator attention stays in graph context — no attention queue; `n` jumps
  to the next node needing the operator. Human Gates are conversational Actor
  Nodes; the focus stub shows one free-text question, not a form.
- Default node information is limited to: kind, dependency topology, active,
  takeable, successful/resolved, adverse terminal, and an orthogonal
  needs-operator flag. State is encoded **glyph-first** (`✓ ► » ✗ ○ ⚑`);
  color only reinforces. Attempts, percentages, Plans, revisions, evidence,
  context use, messages, costs, metrics, logs, activity feeds, tables,
  sidebars, cards, and inspectors are deliberately absent.
- Terminal (shipped) Campaigns are immutable: no mutation/focus actions.

## Public Gate B seed

Both selectable views use the real public Calibre Stage 3 Gate B structure from
[issue #397](https://github.com/Vzlentin/calibre/issues/397): seven planning
Decisions (#398, #399, #400, #401, #402, #403, and #405), twelve serial
Work Items (#406–#417), and the final owner GO Decision. The planning dependencies and serial order are represented
as graph edges; there are no invented Campaign-level parallel `/go` Work Items.

The public work-item issues are [#406](https://github.com/Vzlentin/calibre/issues/406)
through [#417](https://github.com/Vzlentin/calibre/issues/417), with merged PRs
[#418](https://github.com/Vzlentin/calibre/pull/418) through
[#429](https://github.com/Vzlentin/calibre/pull/429).

Exactly two Campaign views are selectable with `c`:

1. **active — reconstructed midpoint:** Decisions #398/#399/#400/#401/#403/#402/#405
   are resolved; #406–#411 succeeded; #412 is active; #413–#417 are pending
   because execution is serial; and the final owner GO Decision is pending and
   not operator-needed. This is an explicit prototype reconstruction, not a
   claim of an exact historical runtime snapshot. Expanded #412 shows plan and
   implement done, a simplify scout fan-out with structure/performance active
   and reuse takeable, then the simplify join/apply, review fan-out, review
   join/post, resolve, and babysit still pending.
2. **shipped — actual final topology:** every Decision and Work Item is
   resolved/succeeded, the final owner GO Decision is resolved, every Actor
   Graph node is done, and the Campaign is immutable/read-only.

## The three variants

Same data, same state, three structurally different layout algorithms and
reading directions — not three color themes. All layout is derived from
nodes/edges at render time (no stored x/y). Only one compound node is expanded
at a time, so expansion never produces a mega-graph.

- **A — Metro/Rails:** a wide left-to-right dependency railway. Columns are
  topological depth, lanes are rails; independent chains share a rail, and
  fan-out/joins are vertical track buses in the gutters. A completed Decision
  or Work Item keeps that Campaign rail compact and unfolds its Actor Graph as
  top-to-bottom history beneath the parent. Active, takeable, and pending nodes
  instead splice their Actor Graph left-to-right into the executable route and
  shift downstream nodes to make room.
- **B — Layered Field:** a top-to-bottom topological strata field. Layers are
  horizontal bands; edges drop vertically between bands with one connector
  row. Expansion inserts the Actor Graph as extra sub-layers centered under
  the expanded node.
- **C — Graph Log:** a narrow-friendly top-to-bottom view inspired by
  `git log --graph`. Every node is one row and dependency rails live in the
  gutter, so branches and joins remain actual graph structure. Expansion
  renders the Actor Graph as a nested graph log indented under the node.

Oversized layouts use a bounded viewport in both interactive and snapshot
modes. A running Campaign opens on operator-needed work when present, otherwise
on its active or takeable frontier (#412 in the reconstructed midpoint). The
selected node stays in view as arrows or `Tab` move it. `<` and `>` show
horizontal continuation; `^` and `v` show vertical continuation. Header and
terse footer stay fixed.

## Run

```bash
python3 prototypes/live-graph-control-room-tui/prototype.py
```

Python 3 stdlib only (`curses`); no tests, framework, package manager,
persistence, backend, or external dependency.

## Snapshots (deterministic, for review)

```bash
python3 prototypes/live-graph-control-room-tui/prototype.py --snapshot A --campaign active --expand 412 --select 412-simplify-structure --width 120 --height 36
python3 prototypes/live-graph-control-room-tui/prototype.py --snapshot B --campaign active --expand 412 --select 412-simplify-performance --width 120 --height 36
python3 prototypes/live-graph-control-room-tui/prototype.py --snapshot C --campaign active --expand 412 --select 412-simplify-reuse --width 120 --height 36
python3 prototypes/live-graph-control-room-tui/prototype.py --snapshot C --campaign shipped --select go --width 120 --height 36
```

The compact viewport can also be checked at 80×24:

```bash
python3 prototypes/live-graph-control-room-tui/prototype.py --snapshot A --campaign active --expand 412 --select 412-simplify-structure --width 80 --height 24
python3 prototypes/live-graph-control-room-tui/prototype.py --snapshot B --campaign active --expand 412 --select 412-simplify-performance --width 80 --height 24
python3 prototypes/live-graph-control-room-tui/prototype.py --snapshot C --campaign active --expand 412 --select 412-simplify-reuse --width 80 --height 24
```

`--expand <id>` renders one compound node expanded, and `--select <id>`
marks a node as selected (`◀`) and focuses the viewport on it. Campaign node
IDs are `398 399 400 401 403 402 405 406 ... 417 go`; expanded #412 Actor
IDs include `412-simplify-structure`, `412-simplify-performance`, and
`412-simplify-reuse`.

## Controls

| key | action |
| --- | --- |
| `1` `2` `3` | switch variant A / B / C |
| `c` | switch reconstructed midpoint / final shipped Campaign |
| arrows / `Tab` | navigate graph nodes and follow the viewport |
| `Enter` | expand/collapse a Decision or Work Item; on an Actor Node show a temporary focus stub |
| `n` | jump to the next needs-operator node; active seed correctly reports none |
| `?` | temporary help/legend overlay |
| `q` | quit |

Shipped Campaigns are immutable: expansion is view-only and Actor focus is
disabled.
