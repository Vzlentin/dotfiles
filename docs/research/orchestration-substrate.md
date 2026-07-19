# Research: Orchestration Kernel and Runtime Substrate

**Ticket:** [Choose the orchestration kernel and runtime substrate](https://github.com/Vzlentin/dotfiles/issues/5)
**Parent:** [Design the adaptive graph orchestration framework](https://github.com/Vzlentin/dotfiles/issues/4)
**Date:** 2026-07-19
**Type:** Research and decision support only — no production implementation.

## Question

Which language, runtime, libraries, and persistence substrate should underpin a
local-first Supervisor requiring deterministic executable UML-like statecharts,
DAG scheduling, durable events/commands, crash recovery, a local web control
room, portable packaging, and optional DSPy/GEPA integration — and which parts
should be built versus adopted?

## Recommendation (one line)

Build the Supervisor as a **TypeScript application on Node.js ≥ 22.13 LTS,
adopting XState v5 for executable statecharts and SQLite (WAL, single file) as
an embedded event-sourced journal**, building the Work Graph DAG scheduler,
event journal, and Supervisor control loop as small deep modules, serving the
control room from the same process, packaging via npm (aligned with pi) plus an
optional single executable (Node SEA / Bun), and isolating DSPy/GEPA in a
**Python sidecar** behind a local seam.

## Requirements restated

From the parent map and domain glossary (root `CONTEXT.md`):

1. **Deterministic control** — the Supervisor advances Campaign control state
   through explicit, inspectable transitions (UML-like statecharts: hierarchy,
   guards, history, parallel regions).
2. **DAG scheduling** — Work Graph readiness over Work Items; Actor Graph
   execution over Actor Roles.
3. **Durable events/commands + crash recovery** — append-only journal,
   deterministic replay, Graph Revisions pinned to Actor Attempts.
4. **Local web control room** — served by the daemon itself; no hosted
   dependency.
5. **Portable packaging** — single-operator install on a dev machine;
   no server fleet, no external database.
6. **Optional DSPy/GEPA integration** — an *isolated* learning plane (product
   boundary already decided), so the kernel itself must not depend on Python.
7. **pi/herdr first adapter** — the initial production Actor Runtime adapter
   targets pi, which is itself distributed as a TypeScript/Node package
   (`@earendil-works/pi-coding-agent`, installed via npm under Node 22).

## Verified facts (dated 2026-07-19)

| Fact | Source |
|---|---|
| XState v5 current at **5.32.5**, MIT license; v5 provides the actor model (`createActor`, invoked/spawned actors) and snapshot persistence/rehydration (`getSnapshot()`, persisted/restored state) | [npm registry](https://registry.npmjs.org/xstate/latest), [stately.ai/docs/persistence](https://stately.ai/docs/persistence) |
| `node:sqlite` built-in module: introduced v22.5.0, unflagged in v22.13.0/v23.4.0, "release candidate" stability as of v25.7.0 | [nodejs.org/api/sqlite.json](https://nodejs.org/api/sqlite.json) |
| `better-sqlite3` current at **12.11.1**, MIT, synchronous API | [npm registry](https://registry.npmjs.org/better-sqlite3/latest) |
| Node Single Executable Applications: stability "Active development" | [nodejs.org/api/single-executable-applications.json](https://nodejs.org/api/single-executable-applications.json) |
| Bun supports `bun build --compile` single-file standalone executables | [bun.sh/docs/bundler/executables](https://bun.sh/docs/bundler/executables) |
| Temporal server persistence is Cassandra or SQL (Postgres/MySQL plugins) — no production embedded SQLite; SQLite appears only in the CLI dev server | [temporalio/temporal `common/config/config.go`](https://github.com/temporalio/temporal/blob/main/common/config/config.go), [temporalio/cli](https://github.com/temporalio/cli) |
| DSPy current at **3.2.1**, requires Python ≥ 3.10 — Python-only ecosystem | [pypi.org/pypi/dspy/json](https://pypi.org/pypi/dspy/json) |
| LangGraph current at **1.2.9** (2026-07-10) with `langgraph-checkpoint-sqlite` 3.1.0 — checkpoint-based, Python | [pypi.org/pypi/langgraph/json](https://pypi.org/pypi/langgraph/json) |
| Python statechart libraries: `sismic` 1.6.11 (2025-10-29, **LGPL-3.0**); `python-statemachine` 3.2.0 (2026-06-17) — active but not full UML statechart semantics (no parallel regions/history parity with SCXML/XState) | [pypi.org/pypi/sismic/json](https://pypi.org/pypi/sismic/json), [pypi.org/pypi/python-statemachine/json](https://pypi.org/pypi/python-statemachine/json) |
| `hono` 4.12.31 — lightweight HTTP framework runnable on Node | [npm registry](https://registry.npmjs.org/hono/latest) |
| pi coding agent is a TypeScript/Node package installed via npm under Node 22 (observed locally at `node-v22…/lib/node_modules/@earendil-works/pi-coding-agent`) | local installation |

Judgment (not verified fact) is marked as such below.

## Candidate evaluation

### A. TypeScript/Node + XState v5 + SQLite — **recommended**

- **Statecharts: adopt.** XState v5 is the most mature executable-statechart
  library in any mainstream ecosystem: hierarchical and parallel states,
  guards, actions, delayed transitions, and — decisive for crash recovery —
  serializable actor snapshots with rehydration. The v5 actor model maps
  directly onto the domain: the Supervisor is a root actor, an Actor Attempt
  is an invoked/spawned actor pinned to a program + Graph Revision, a Human
  Gate is an actor awaiting an external event. Snapshot persistence plus an
  append-only event journal gives deterministic replay.
- **DAG scheduling: build.** XState does not schedule DAGs, and no credible
  adoptable local-first DAG scheduler exists (see rejections). The Work Graph
  scheduler is a shallow, well-bounded algorithm (readiness via topological
  gating over the journal) — a classic deep module with a tiny interface:
  `eligible(graphRevision, journal) → [WorkItem]`. Owning it also keeps Graph
  Revision semantics under our control.
- **Persistence: adopt SQLite, build the journal.** SQLite in WAL mode is the
  standard local-first durable store: single file, transactional, portable,
  zero-admin. Two driver options behind a storage seam: `better-sqlite3`
  (mature, synchronous, but a native module that complicates SEA packaging) or
  built-in `node:sqlite` (no dependency, release-candidate stability). The
  event-sourced journal itself (append-only `events`/`commands` tables plus
  snapshot tables, with a tiny migration runner) is built — it is the heart of
  crash recovery and provenance and should not be delegated.
- **Control room: same process.** An HTTP server (Hono or `node:http`) with
  SSE/WebSocket streaming serves a small bundled SPA from the daemon. One
  process, one port, no external web tier.
- **Packaging: npm first, single executable optional.** The first production
  adapter is pi/herdr, and pi is already an npm-installed TypeScript package —
  distribution through npm aligns the framework with its primary runtime
  ecosystem and lets the pi adapter integrate in-process if desired. For
  pi-less installs, Node SEA or `bun build --compile` yield a single
  executable; both are verified available, SEA still marked "active
  development".
- **DSPy/GEPA: isolated Python sidecar.** The learning plane is already a
  decided product boundary; DSPy 3.x is Python-only. A versioned local seam
  (JSON-RPC over stdio or localhost HTTP) keeps every Python dependency out of
  the kernel and out of the dotfiles' stdlib-only scripts, and makes the
  learning plane independently replaceable.

**Risks (judgment):** XState's freedom means effect discipline must be imposed
by convention — side effects of an Actor Attempt must be journaled, never
re-executed on replay; this needs an explicit adapter contract (feeds ticket
#12). Node single-executable tooling is younger than Go's.

### B. Python kernel (FastAPI + sismic or python-statemachine + SQLite) — rejected

Strongest appeal: DSPy-native, and this repo's scripts are already Python.
Rejected because: (1) no Python statechart library delivers full UML/SCXML
semantics with mature snapshot persistence — sismic is closest but LGPL-3.0
(license friction for a public, redistributable tool) and python-statemachine
lacks parallel regions/history parity, so the core interpreter would be built
anyway; (2) packaging a portable daemon-plus-web-UI in Python is materially
weaker (end users need a managed Python env or PyInstaller-style bundling);
(3) the learning plane is isolated by decision, so Python-nativeness buys the
kernel little while costing it the XState adoption and the pi ecosystem
alignment. Python remains required — but confined to the sidecar.

### C. Temporal (Go/TS/Python SDK) — rejected

Temporal is the obvious "adopt a durable execution engine" candidate and its
event-history replay model is exactly right conceptually. Rejected on the
local-first requirement: the server requires Cassandra or Postgres/MySQL
persistence (SQLite only in the dev CLI), plus a visibility store and a
multi-service deployment — a fleet to run a single-operator daemon. Its
determinism model is code-replay of workflow functions, not inspectable
UML-like statecharts, and Graph Revision semantics would fight its versioning
model. Judgment: the operational weight disqualifies it regardless of feature
fit.

### D. LangGraph (Python) — rejected, kept as reference

The closest adoptable graph runtime with a SQLite checkpointer. But it is a
checkpointed LLM-agent graph framework, not a deterministic control plane:
persistence is state snapshots, not an event-sourced command journal; graphs
are node/edge programs, not UML statecharts; and adopting it drags the kernel
into Python (see B). Its checkpointer and graph-revision ideas are worth
studying when designing the journal schema.

### E. Go kernel (custom interpreter + modernc.org/sqlite) — rejected

Best-in-class single-static-binary packaging and daemon ergonomics. Rejected
because every other axis regresses: no mature UML statechart library exists in
Go (the interpreter — the riskiest core module — would be built from scratch),
the control-room UI and the pi adapter (TypeScript) cross a language boundary,
and DSPy is still a sidecar. Go's one decisive win (packaging) is largely
closed by npm + SEA/Bun, while XState adoption is decisive in the other
direction.

### F. Rust kernel — rejected

Determinism and packaging appeal, but development velocity, ecosystem
mismatch for web/LLM-adjacent work, and the same missing-statechart-library
problem as Go. Not competitive for a single-maintainer local tool.

### G. Other adoptable platforms (DBOS, Restate, Hatchet, Windmill, Prefect, Dagster) — rejected

DBOS and Hatchet require Postgres; Restate is a separate Rust server binary;
Windmill/Prefect/Dagster are data-pipeline or job-platform oriented with
server infrastructure. All violate local-first single-process packaging or the
deterministic statechart control model.

## Build vs adopt ledger

**Adopt**

- XState v5 — executable statecharts, actor model, snapshot persistence (MIT).
- SQLite (WAL) — embedded durable store; driver behind a seam
  (`node:sqlite` preferred once stable, `better-sqlite3` as the proven option).
- Hono or `node:http` + SSE — control-room transport.
- A schema-validation library (e.g. zod) at manifest and seam boundaries.
- npm (primary) + Node SEA / `bun build --compile` (optional single binary).
- DSPy/GEPA — only inside the isolated Python sidecar.

**Build** (small deep modules, each behind an explicit seam)

- Event-sourced journal + deterministic replay (append-only events/commands,
  snapshot tables, migrations).
- Work Graph DAG scheduler (readiness gating over a Graph Revision).
- Supervisor control loop (root XState actor; authorizes Actor Attempts).
- Manifest compiler interface (manifests → versioned machine definitions —
  interfaces with ticket #10).
- Actor Runtime adapter contract + pi/herdr adapter (ticket #12).
- Control-room SPA and its streaming protocol (ticket #17).
- Sidecar seam protocol for the learning plane (ticket #8/#15).

## Newly visible decisions and fog

- **Driver choice deferred behind the storage seam:** `node:sqlite` (no native
  dep, RC stability) vs `better-sqlite3` (mature, native module complicating
  SEA). Decide at implementation time; the seam makes it reversible.
- **Effect-determinism boundary** (new ADR candidate): which parts of an Actor
  Attempt are journaled vs replayed; XState permits arbitrary effects, so the
  adapter contract must enforce journaling discipline.
- **Journal schema and migration discipline** is the framework's most
  consequential early artifact — versioning it is a prerequisite for Graph
  Revision provenance and deserves its own ADR.
- **Control-room UI stack** (Svelte vs Preact vs vanilla + SSE) is deliberately
  left to ticket #17; only the transport (same-process HTTP + SSE) is fixed
  here.
- **Fog:** whether `node:sqlite` reaches full stability on the project's
  timeline; whether XState snapshot format stability across upgrades needs a
  versioned snapshot wrapper (mitigation: store snapshots behind the same
  schema-versioned seam as the journal).

## Appendix: module shape (judgment, for handoff)

```
supervisor/        root actor, control loop, capability checks
journal/           append-only log, snapshots, replay, migrations (seam: driver)
workgraph/         DAG scheduler over Graph Revisions
actorgraph/        Actor Attempt lifecycle, adapter contract
adapters/pi/       pi/herdr production adapter
adapters/test/     in-memory test adapter
manifest/          schema + compiler interface to machine definitions
controlroom/       HTTP + SSE server, bundled SPA
sidecar/           DSPy/GEPA Python process, versioned JSON seam
```

Each module is deep: narrow interface, substantial hidden mechanics, paired
production and test adapters.
