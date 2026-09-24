# Pi RLM invocation and runtime

Pi discovers this skill from `~/.agents/skills/rlm`; its files may link to the
shared dotfiles source. Hermes discovers the same directory through its existing
external-skills setting. Use `/skill:rlm <task>` or Pi's native skill picker.
`/rlm` requires a separately configured alias; the skill does not install one. With no task argument, apply the skill
to the active task rather than inventing a new investigation.

The installed `pi-ipython-rlm` extension supplies `ipython` with a single `code`
field. Hermes's `action`, `cwd` and `max_child_calls` options are not Pi parameters.
Use the registered description for current output, child-request and lifecycle
limits. The tool is registered in `extensions/rlm.ts` in the loaded
`pi-ipython-rlm` package; its shared API and guidance are loaded from
`rlm/prompts/ipython.json` in the standalone librlm checkout. This skill adds
task-level orchestration only when loaded; ordinary persistent Python work
does not require it.

The extension loads the standalone librlm bridge through its own Python 3.12
runtime. Use project commands or the project's interpreter for project tests and
dependencies. Do not alter the extension's provisioned runtime to satisfy an
unrelated project.

Pi's `/reload` reloads skills, prompt templates and extensions. It also shuts down
the old RLM kernel, so saved Python variables and outstanding handles are lost.
Use a fresh session or reload an idle owner after installation; do not reload as a
routine step in the middle of an investigation. Verify actual cross-cell state
and the native tool response before claiming continuity.

Pi installs the extension from `https://github.com/Vzlentin/pi-ipython-rlm` into
its managed checkout; the development checkout is `~/Dev/pi-ipython-rlm`. The
independent library is `~/Dev/librlm`.
There is no bundled subtree. Both `extensions/librlm.ts` and
`extensions/ipython.py` resolve the library from `RLM_LIBRLM_ROOT`, or default to
`~/Dev/librlm` regardless of the Pi package location. Overrides must be absolute
paths (`~/...` is accepted). Missing files fail explicitly; no other copy is
silently substituted.

Pi owns its Python runtime, provider routing and UI. Librlm owns the shared
bridge, async API and instructions. Hermes consumes the same library through
`~/Dev/librlm/integrations/hermes/ipython-rlm`, using its own interpreter policy.

Check the loaded package location before diagnosing or editing it. A Git-installed
package can run from Pi's managed checkout rather than the development checkout;
edits to the development copy do not update that installed copy until they are
pushed and `pi update --extensions` runs. Do not reload an active kernel just to
pick up documentation changes.

A path mismatch or missing interpreter is a runtime problem; skill text cannot
repair it. Do not silently replace the native tool with unrelated terminal Python.
