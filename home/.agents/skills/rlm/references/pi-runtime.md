# Pi RLM invocation and runtime

Pi discovers this skill from `~/.agents/skills/rlm`; its files may link to the
shared dotfiles source. Hermes discovers the same directory through its existing
external-skills setting. Use `/skill:rlm <task>` or Pi's native skill picker.
`/rlm` requires a separately configured alias; the skill does not install one. With no task argument, apply the skill
to the active task rather than inventing a new investigation.

Two Pi packages provide the runtime. `pi-ipython` registers `ipython` with a single
`code` field and owns the kernel, its Python 3.12 runtime, output limits and
`/cells`. `pi-rlm` binds `rlm` in that kernel, runs child completions and adds the
RLM API and guidance (from librlm's `rlm/prompts/ipython.json`) as an `rlm` system
prompt section. Hermes's `action`, `cwd` and `max_child_calls` options are not Pi
parameters. With only pi-ipython loaded, `rlm` is undefined. This skill adds
task-level orchestration only when loaded; ordinary persistent Python work
does not require it.

In Pi, `rlm.final(value)` prints the value at the end of the cell's output and in
`details.final`; it does not end the turn. Child usage is added to the `ipython`
result's usage.

Use project commands or the project's interpreter for project tests and
dependencies. Do not alter the extension's provisioned runtime to satisfy an
unrelated project.

Pi's `/reload` reloads skills, prompt templates and extensions. It also shuts down
the old kernel, so saved Python variables and outstanding handles are lost.
Use a fresh session or reload an idle owner after installation; do not reload as a
routine step in the middle of an investigation. Verify actual cross-cell state
and the native tool response before claiming continuity.

Pi installs `https://github.com/Vzlentin/pi-ipython` and
`https://github.com/Vzlentin/pi-rlm` into its managed checkouts. pi-rlm follows
librlm `main`: it clones `https://github.com/Vzlentin/librlm` into
`${XDG_DATA_HOME:-~/.local/share}/pi-rlm/librlm` on first use and fast-forwards it
at session start, warning and keeping the clone if the pull fails. An absolute
`RLM_LIBRLM_ROOT` (`~/...` is accepted) selects a development checkout instead,
which is never pulled. A librlm with an unsupported host protocol or prompt schema
fails loudly; no other copy is substituted.

Librlm owns the in-kernel RLM extension (`rlm/ipython_extension.py`), async API and
instructions. Hermes loads the same extension through
`librlm/integrations/hermes/ipython-rlm`, using its own interpreter policy.

Check the loaded package location before diagnosing or editing it. A Git-installed
package runs from Pi's managed checkout rather than a development checkout;
edits to the development copy do not update that installed copy until they are
pushed and `pi update --extensions` runs. Do not reload an active kernel just to
pick up documentation changes.

A path mismatch or missing interpreter is a runtime problem; skill text cannot
repair it. Do not silently replace the native tool with unrelated terminal Python.
