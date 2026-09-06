# Pi RLM invocation and runtime

Pi discovers this skill natively from the real directory `~/.agents/skills/rlm`.
Hermes discovers the same directory through its existing external-skills setting. Use `/skill:rlm <task>` or Pi's native skill picker;
no prompt template or alias is installed. With no task argument, apply the skill
to the active task rather than inventing a new investigation.

The installed `pi-ipython-rlm` extension supplies `ipython` with a single `code`
field. Hermes's `action`, `cwd` and `max_child_calls` options are not Pi parameters.
Use the registered description for current output, child-request and lifecycle
limits. The shared API and base guidance live in
`~/Dev/librlm/rlm/prompts/ipython.json`; this skill adds task-level orchestration
only when loaded.

The extension loads the standalone librlm bridge through its own Python 3.12
runtime. Use project commands or the project's interpreter for project tests and
dependencies. Do not alter the extension's provisioned runtime to satisfy an
unrelated project.

Pi's `/reload` reloads skills, prompt templates and extensions. It also shuts down
the old RLM kernel, so saved Python variables and outstanding handles are lost.
Use a fresh session or reload an idle owner after installation; do not reload as a
routine step in the middle of an investigation. Verify actual cross-cell state
and the native tool response before claiming continuity.

The maintained extension is `~/Dev/pi-ipython-rlm`; its `extensions/librlm.ts`
resolves the sibling librlm checkout or `RLM_LIBRLM_ROOT`. A path mismatch or
missing interpreter is a runtime problem; skill text cannot repair it. Do not
silently replace the native tool with unrelated terminal Python.
