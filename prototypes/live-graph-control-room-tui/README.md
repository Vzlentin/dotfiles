# PROTOTYPE — THROWAWAY: live graph control room TUI

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

## The three variants

Same data, same state, three structurally different layout algorithms and
reading directions — not three color themes. All layout is derived from
nodes/edges at render time (no stored x/y). Only one compound node is
expanded at a time, so expansion never produces a mega-graph.

- **A — Metro/Rails:** a wide left-to-right dependency railway. Columns are
  topological depth, lanes are rails; independent chains share a rail, and
  fan-out/joins are vertical track buses in the gutters. Expansion stretches
  the node into its Actor Graph in place: descendants shift right and the
  actor layers occupy the freed columns.
- **B — Layered Field:** a top-to-bottom topological strata field. Layers are
  horizontal bands; edges drop vertically between bands with one connector
  row. Expansion inserts the Actor Graph as extra sub-layers centered under
  the expanded node; descendants shift down.
- **C — Graph Log:** a narrow-friendly top-to-bottom view inspired by
  `git log --graph`. Every node is one row and dependency rails live in the
  gutter, so branches and joins remain actual graph structure. Expansion
  renders the Actor Graph as a nested graph log indented under the node with
  the main rails kept intact.

## Seed data

Exactly two selectable Campaigns (`c` switches):

1. **active — "live graph control room":** a resolved Decision (`pick
   layout`) fanning out to two concurrent active Work Items (`tui variants`,
   `snapshot harness`) and one active Decision (`expansion model`, grilling
   discipline, needs-operator ⚑); a takeable join (`keyboard polish`); a
   pending downstream node (`publish`). The `tui variants` Actor Graph shows
   logical `/go` stages with a scout fan-out/join; the `expansion model`
   Actor Graph shows a failed grilling round and an active ⚑ round with a
   free-text question.
2. **shipped — "campaign queue drain":** all Decisions resolved, all Work
   Items succeeded, visibly immutable/read-only; expansion is view-only and
   focus actions are disabled. Useful for judging whether completed graphs
   become quiet rather than noisy.

## Run

```bash
python3 prototypes/live-graph-control-room-tui/prototype.py
```

Python 3 stdlib only (`curses`); no tests, framework, package manager,
persistence, backend, or external dependency.

## Snapshots (deterministic, for review)

```bash
python3 prototypes/live-graph-control-room-tui/prototype.py --snapshot A --campaign active --width 120 --height 36
python3 prototypes/live-graph-control-room-tui/prototype.py --snapshot B --campaign active --expand w1 --width 120 --height 36
python3 prototypes/live-graph-control-room-tui/prototype.py --snapshot C --campaign active --expand d2 --select d2a2 --width 120 --height 36
python3 prototypes/live-graph-control-room-tui/prototype.py --snapshot A --campaign shipped --width 120 --height 36
```

`--expand <id>` renders a compound node expanded, `--select <id>` marks a
node as selected (`◀`). Snapshot output is the same layout and state the
interactive TUI renders. Node ids: `d1 w1 w2 d2 w3 w4` (active),
`d1 w1 w2 w3` (shipped); actor ids are visible in the source seed data.

## Controls

| key | action |
| --- | --- |
| `1` `2` `3` | switch variant A / B / C |
| `c` | switch active / shipped Campaign |
| arrows / `Tab` | navigate graph nodes |
| `Enter` | expand/collapse a Decision or Work Item; on an Actor Node show a temporary "would focus Herdr pane …" stub (disabled when shipped) |
| `n` | jump to next ⚑ needs-operator node (shows its free-text question) |
| `?` | temporary help/legend overlay |
| `q` | quit |

A compact "too small: need WxH" message appears when the terminal cannot fit
the current layout. There is no permanent help chrome beyond one terse
footer.

## Known visual limitations (accepted for a throwaway)

- Long cross-column edges pass through gutter cells immediately after node
  labels, which can read as a stray `│` next to a label (e.g. the
  `d2 → publish` route in variant A).
- Edge crossings are rendered as `┼` without hop-over marks.
- Glyph alignment depends on the terminal rendering `✓ ► » ✗ ○ ⚑ ◆ ■ ● ↳` as
  narrow (width-1) characters.
