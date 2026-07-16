# Stage 1 — pane-backed implementation worker brief

Render the brief below into `PROMPT` and launch it as one root `omp` session
through SKILL.md's Pane-backed worker contract. Fill in `#N`, `<type>/<slug>`,
`<WORKDIR>`, the project's quality-gate commands (as its AGENTS.md/CI define
them), and the plan path.

---

> Invoke the `ce-work` skill to implement the plan below for GitHub issue #N.
> Treat the provided plan as the complete spec — do not re-plan, do not ask to
> narrow scope.
>
> Setup, non-interactively (do not stop to ask which branch) — use the clause for
> this run's mode (from Stage 0d):
> - **Direct mode:** from an up-to-date `main`, create the feature branch
>   `<type>/<slug>` in this checkout. Do not commit to `main`.
> - **Worktree mode:** the branch and worktree already exist. `cd` into
>   `<WORKDIR>` (the absolute worktree path) and implement on the existing
>   `<type>/<slug>` branch — do **not** create a branch, do **not** touch the
>   main checkout.
>
> Execute directly in this pane using `ce-work`'s inline execution engine.
> Do not invoke the `task`, `job`, or `irc` tools and do not spawn nested
> agents. This root session is the sole implementation worker so the complete
> implementation trace remains visible in herdr. If the plan requires an
> unresolved product decision, stop and report the blocker instead of guessing.
>
> Run the project's quality gates — <the project's own gate commands, as its
> AGENTS.md/CI define them> — in the **FOREGROUND**, blocking on each gate's
> exit before you report. Do **not** end your turn with any gate still running in
> the background: a gate still running when the turn ends is abandoned, not
> resumed — nothing picks it back up. Commit only after the gates pass green.
>
> Finish by pushing the branch and opening a PR whose body includes `closes #N`,
> a <=70-char title, a 3-bullet summary, and a test-plan checklist.
>
> Report back: PR number, PR URL, and the branch name.
>
> --- PLAN (complete spec) ---
> <paste the full path to the plan from the resolved /project-memory store>
