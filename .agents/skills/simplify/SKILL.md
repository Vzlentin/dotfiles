---
name: simplify
description: Simplify a branch diff without changing behavior. Use before review or when introduced code needs structural, performance, or reuse cleanup.
---

# simplify

Simplify the code this branch introduced, without changing behavior. Scope is
the branch diff against the default branch (`git diff origin/main...HEAD`,
plus staged/unstaged changes); never widen it to pre-existing code unless a
fix directly depends on touching it.

## Step 1 — Fan out three scout lenses

Launch three **blocking, read-only scouts in parallel** via the harness's
native subagent mechanism (for the pi recipe, see the `go` skill's
`references/harness/pi.md`; with no subagent mechanism, run the three lenses
inline, one after another). Each scout gets the full diff (or its path),
its lens below pasted into the task text, and the output contract: findings
as `severity (P0-P3) — file:line — what — verbatim quoted line — proposed
fix`, behavior-preserving fixes only, zero findings valid.

**STEP 1 GATE:** all three scouts returned, or a named launch failure stops
the skill; retain every returned finding for disposition in Step 2.

**Lens 1 — code quality & slop.** AI-slop and structure: comments that
narrate the obvious or break local style; defensive checks and try/catch on
trusted internal paths; casts that bypass the type system; deep nesting that
early returns would flatten; dead code; copy-paste that should be one helper;
ad-hoc special-case branches bolted into unrelated flows; wrappers that add
indirection without clarity. Be ambitious: prefer restructurings that make
whole branches or layers disappear over local polish.

**Lens 2 — performance.** Unnecessary work introduced by the diff: repeated
computation that should hoist, N+1 or per-item I/O that should batch,
obviously independent awaits run sequentially, allocations or copies in hot
paths, no-op updates. Flag only what the diff introduced and only when the
fix stays behavior-preserving.

**Lens 3 — reuse.** Reinvented wheels: stdlib/runtime primitives
reimplemented by hand, existing project helpers duplicated (name the
canonical one with its path), near-duplicate logic within the diff itself,
config or constants that already exist elsewhere.

## Step 2 — Apply, verify, commit

Scouts never write; the orchestrator applies. Give every retained finding
exactly one disposition: apply a clear behavior-preserving improvement, or
skip it with a concrete false-positive or taste-call reason. **Preserve every
safety check** at a
trust boundary — validation of external input, security guards, error
handling that prevents data loss.

After applying, rerun the project's quality gates (as its `AGENTS.md`/CI
define them) in the foreground. **Commit and push only on green** — never
chain the commit unconditionally after the gates. If a gate is red, fix or
revert the offending simplification first. If nothing was worth applying,
report that and leave the tree untouched.

Finish with a short summary: applied per lens, skipped (and why), and the
gate results.
