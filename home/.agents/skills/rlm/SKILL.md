---
name: rlm
description: Run RLM-assisted investigations and context-heavy analysis with native persistent IPython, focused child questions, evidence tracking, and recovery. Use for /rlm, requested RLM work, or mining saved RLM traces.
license: MIT
metadata:
  version: 0.2.0
  author: Valentin, Hermes Agent
  platforms: [linux, macos]
  hermes:
    tags: [rlm, ipython, persistent-kernel, investigation, traces]
---

# RLM

Carry out the supplied task using a persistent IPython workspace and focused child questions where useful. Use the task supplied with the skill invocation; without arguments, continue the established task. If neither exists, ask what to work on. Preserve the user's scope, restrictions and existing authorization. Invoking this skill does not itself request a new research campaign, benchmark or prompt rewrite.

## Choose useful work

- Use Python for parsing, scheduling, joins, coverage and persistence. Do a known lookup, edit or command inline. Run project code and tests through the project's own runtime; do not install project dependencies into the orchestration kernel.
- For exhaustive work, track and complete the requested inputs. Batch independent semantic reads when useful; exhaustiveness concerns coverage, not a mandatory schedule.
- For an investigation, begin with a bounded evidence pass within the task's limits. Let returned findings determine consequential followups. Do not precommit all later questions before seeing the evidence, or make another call merely to appear adaptive. Stop when the question is supported, decisive evidence is unavailable, or the budget is reached; disclose remaining gaps.
- Combine deterministic checks and the actions they determine when the next steps are clear. Use another turn when new evidence needs interpretation. Inspect state when uncertain, without making an inspection-only turn mandatory.

## Preserve evidence

Keep large inputs and full results in named variables or files. Give each child a specific question, sufficient labelled evidence and the expected output. Children have no tools or filesystem access: a path alone is not their evidence.

Preserve immutable source IDs, versions, passage or line ranges, and missing sections. Keep related chunks attached to their source before cross-source synthesis. Reconcile requested coverage before finalizing; cite passages that support the claims and distinguish findings from inference. Partial chunks do not establish what unread sections contain.

Check actual request limits and unintended duplicate dispatches within the dispatch cell when practical. Track completed analysis by question and evidence, not source ID alone. A new question about an already-read source, required verification, an authorized repeatability test, or a retry after a real failure can justify another call.

## Use the native kernel

Use the current harness's `ipython` tool. Its registered description supplies the API and limits. The kernel's `rlm` object is already bound; do not import over it. `spawn`, `gather`, `release` and `final` are async. Child context must be text or `None`; serialize structured evidence before dispatch.

Keep handles and gathered `ChildResult` values in named variables. Gather returns results in the supplied handle order and delivers each handle once; transport recovery is internal. Check each result's `status` before using `text`: a successful cell or gather can contain a failed child. Retain returned values for reuse and serialize them with `.to_wire()` when saving. Release unused handles; already-gathered handles need no routine second gather or release.

Repair presentation or persistence from successful retained results before considering another analysis. Do not clear completed state to initialize a continuation. After a child failure, inspect its actual status and reconsider task breadth or context as relevant; a transport error does not by itself justify dropping evidence. Keep source IDs separate from storage aliases and check a helper's storage contract before expensive dispatch.

Return bounded, source-grounded findings and targeted diagnostics; inspect larger excerpts when needed. Record actual root/child calls and available usage when assessing cost. Use `await rlm.final(value)` for the complete requested answer. Kernel state is process persistence, so save valuable results for crash recovery; a reset loses in-memory state.

## Read only the relevant reference

- **Pi invocation, loading or runtime trouble:** [Pi runtime](references/pi-runtime.md). Pi also supports `/skill:rlm`.
- **Hermes options, child admission or runtime trouble:** [Hermes IPython](references/ipython-tool.md). Hermes starts with `max_child_calls=0`; use a bounded positive allowance when the task calls for semantic children. Existing task authorization carries forward.
- **Saved-trace analysis:** [Trace mining](references/trace-mining.md). Parse saved data without executing historical runners, keep derivatives separate, and preserve held-out boundaries. A mining-only task does not authorize fresh research calls.

If native IPython is unavailable, establish the actual runtime before claiming persistence. Separate shell processes or an old LocalREPL trace do not prove native shared-kernel continuity. Do not modify a live conversation's tools to conceal that limitation.
