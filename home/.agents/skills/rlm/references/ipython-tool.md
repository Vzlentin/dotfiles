# Native Hermes IPython tool

## Installed module

The personal `ipython-rlm` plugin lives under the active profile's `plugins/ipython-rlm/`; it registers `ipython` in toolset `ipython_rlm`. It does not modify Hermes core or the Pi checkout. After installation/enabling, restart the owning Hermes process before opening a new chat: Desktop New Chat reuses its long-lived `hermes serve` backend, whose PluginManager discovery is cached. A new conversation alone does not guarantee discovery of a newly installed plugin. Never rewrite a live conversation's tool catalog.

For a missing tool, distinguish disk installation, runtime prerequisites, fresh-process registration, desktop toolset selection, and the running backend's catalog. Check both configured runtime files on the actual backend host before recommending a restart: `rlm/bridge.py` and `.venv/bin/python`. Plugin doctor validates registration, not kernel readiness; it can pass while the tool's `check_fn` hides `ipython` because the runtime interpreter is missing. A synced checkout can exist without its ignored virtualenv. Run the native probe to test startup; report a missing-runtime failure separately from stale discovery, and do not claim a restart alone repairs it. Compare backend startup against installation and inspect `PluginManager.discover_and_load` caching. In the installed desktop runtime, `_load_enabled_toolsets('desktop')` resolves CLI configuration plus GUI toolsets; newly discovered plugin toolsets may be included automatically, so absence from the saved CLI list alone is not a reason to edit config. The standalone native probe explicitly discovers plugins in a new process: its success does not verify the already-running desktop backend. Request consent before restarting an active backend, since other chats may be running. Distinguish the messaging gateway from Desktop's `hermes serve` backend: the UI's Restart Gateway action does not necessarily restart the process owning the desktop chat. Verify the terminal tool's process ancestry and the backend PID/start time after a claimed restart; an unchanged owning process has not rediscovered plugins. Fully quitting/reopening Desktop is distinct from restarting its messaging gateway.

Its maintained source is `~/Dev/librlm/integrations/hermes/ipython-rlm`; the installed profile plugin links there. It launches `~/Dev/librlm/rlm/bridge.py` with `~/Dev/librlm/.venv/bin/python`. Shared tool instructions come from `rlm/prompts/ipython.json` in the same checkout. Configure a different checkout through `terminal(command="hermes config set plugins.entries.ipython-rlm.settings.runtime_repo /absolute/checkout")`. Verify files and bridge protocol compatibility before reuse; do not silently update the dependency. The currently supported bridge/child protocols are 6/2.

For status/validation, use `terminal(command="hermes plugins list --plain --no-bundled")` and `terminal(command="hermes plugins doctor ipython-rlm --ci")`. Plugin activation uses `hermes plugins enable ipython-rlm --no-allow-tool-override`; removal from future sessions uses `hermes plugins disable ipython-rlm`. Load the Hermes skill before changing integration settings.

## Exact calls

- Inspect without starting: `ipython(action='status')`.
- Deterministic cell: `ipython(code='values = [3, 5, 7]\nprint(sum(values))', cwd='/absolute/workdir', max_child_calls=0)`.
- Later cell: `ipython(code='print(values[-1])')` uses the same kernel while the chat and owner process remain alive.
- Authorized child cell: `ipython(code="h = await rlm.spawn('focused question', context=labelled_excerpt)\nreports = await rlm.gather([h])\nprint(reports[0])", max_child_calls=1)`.
- Destroy state deliberately: `ipython(action='reset')`. The next execute creates a fresh kernel; prior variables are gone.

`timeout` defaults to 120 seconds, accepts 1–300, and excludes initial startup (separate 45-second readiness deadline). `max_child_calls` defaults to 0 and accepts 0–4 per cell. It counts admitted attempts, including failures, not just successful completions. There are at most four chat kernels in one plugin owner; reset/close idle chats rather than silently evicting state.

`rlm.spawn`, `rlm.gather`, `rlm.release`, and `rlm.final` are async; await them. Gather takes a list/iterable of handles and returns typed mapping-like results (`status`, `text`, `error`, `usage`, `elapsed_ms`, `truncated`). Validate each result: a Python cell can succeed while a child result reports an error. Handles survive successful cells until gathered or released. Admission retains the originating cell budget, deadline, and host routing context; a later gather does not authorize new calls. Retain assigned returned values for later cells: a consumed handle cannot be gathered again. Serialize reports with `report.to_wire()`. This adapter uses the async spawn/gather route; do not assume old direct-librlm `llm_query_batched` wrappers have the same host adapter.

## Model routing and scope

Children call the documented `ctx.llm.complete` host facade with a focused task and explicit context, no tools, no recursive tool access, and no copied parent history/skills. The plugin does not read credential files or supply provider/model/profile overrides. The installed host owns routing and auth; do not claim a chat-local model override is inherited without verifying that Hermes version's resolver. Record actual provider/model and returned usage; unknown cost stays unknown. The bridge's `truncated` flag does not establish that a provider avoided its token limit: this installed host facade does not expose a finish reason to the adapter, so provider-side truncation remains unverified.

The installed SDK can lag the live docs: inspect actual method signatures before using newer conveniences such as `ctx.llm.scope()`. Do not invent methods based solely on newer documentation.

## Lifecycle, evidence, and limits

- Chat identity comes from the host's `session_id`; a missing identity fails closed instead of falling back to one shared kernel. Different chats have different namespaces.
- Ordinary Python errors retain successful assignments/imports from earlier statements. Timeout or bridge failure discards the kernel and returns `state_lost`; subsequent execution requires explicit reset. Do not automatically replay potentially completed external actions.
- State is live-process persistence, not durability across Hermes restarts or crash recovery. Checkpoint useful data yourself outside protected sources.
- Cleanup uses session finalize/reset hooks and process exit, **not** `on_session_end`, which fires after every conversation turn. The latter would erase cross-turn state.
- Initial cwd is fixed per kernel and reinstated by bridge bootstrap. `%cd` can affect the current cell, but should not be relied on across calls; reset for a new initial directory.
- A completed child is retained in memory before its audit checkpoint. Checkpoint failures expose a request ID in `uncheckpointed_children` and preserve the real gathered result; the next execute retries only the checkpoint, never the provider call. Save assigned reports after repairing storage.
- Full code/output events and admitted child request/results are saved in profile-local `cache/ipython-rlm/<kernel-id>/`. Cell results expose `audit_path`; stdout is capped at 12,000 characters and the complete chat response at 16,000, including final values and metadata. Oversized responses retain their full result event in the audit and return a labelled preview. Logs contain private evidence: keep local. Host-channel authentication tokens are omitted from child logs.
- This is POSIX/local host execution, **not a sandbox or read-only enforcement layer**. It refuses a configured remote/sandbox terminal backend. Obey the user's file and network restrictions; disabling child calls does not prohibit arbitrary Python networking.
- Kernel timeout stops owned Python processes. An already-submitted provider request may continue until the host/provider timeout; do not promise that local cancellation revokes remote billing. No new requests are admitted after their originating execution is released or its deadline expires, or after the kernel closes.

## Verification commands

Use the existing runtime interpreter via `terminal`:

`~/Dev/librlm/.venv/bin/python -m pytest <active-profile>/plugins/ipython-rlm/tests/test_ipython.py -q`

The native integration probe is `tests/verify_native.py`, run using the Hermes interpreter. It exercises actual plugin discovery and tool dispatch plus explicitly mocked provider completion; it does not launch a research run. Always report real kernel tests, mock-provider checks, and live-provider acceptance separately.
