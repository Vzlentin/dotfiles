# Read-only RLM trace mining

## Split whole investigation families

- Assign an entire connected investigation to one split, using `leakageGroup`. Keep related parent sessions, child calls, retries, checkpoint repairs, summaries, and copied excerpts together. Different jobs, machines, filenames, or timestamps do not prove independence; do not randomly split individual calls from the same family.
- Neither `heldOut` nor `quarantine` content may enter optimization, reflection, prompt design, or candidate selection. `unassigned` episodes are also ineligible until an independence and leakage audit records their assignment.
- Freeze the candidate and evaluation criteria before opening held-out content for final evaluation. Record any exposure or discovered cross-family link and revise the split's contamination status before claiming generalization. Do not quietly relabel exposed examples as independent held-out evidence.

## Collect without replay

For Pi 1.0.3 with the installed `pi-ipython`, `pi-rlm`, and librlm, distinguish these sources. Inspect actual schemas before applying this map to older runs.

| Evidence source | Contents | Retention |
| --- | --- | --- |
| Pi session JSONL | Session header, entry tree, assistant tool arguments, final tool-result content and details, usage, bounded nested-call summaries, and extension entries. | Automatically saved in persisted sessions, not with `--no-session`. Streaming updates are not saved. |
| Explicitly saved child results | `ChildResult.to_wire()` fields: `status`, `text`, `error`, `usage`, `elapsed_ms`, `truncated`. | Only available when saved or exposed in retained output. Pi RLM children use `--no-session`, so full child transcripts are not automatically retained. Returned child text is limited to 256 KiB. |
| Temporary output | IPython `fullOutputPath` and overflow-capture files under the OS temp directory's `pi-ipython-output-*/output-*.txt`, plus codemode spill and image files. | IPython files survive kernel restarts but are deleted at runtime shutdown. Codemode paths are temporary files, not an archive. Verify each file still exists. |
| IPython SQLite input history | `history.sqlite` in the active IPython profile, normally `$IPYTHONDIR/profile_default/history.sqlite` for the default profile. `home/.zshenv` sets `IPYTHONDIR` to `$XDG_CONFIG_HOME/ipython`. Raw and transformed inputs have IPython session/line numbers, not Pi session or branch IDs. | Inputs are saved by default when SQLite is available (`pi-ipython` requests `store_history=True`). Profile/environment and `HistoryManager.hist_file`/`enabled` settings can change the path or disable disk history. Output logging is off by default (`db_log_output=False`). Background writes can fail or remain pending, so complete retention and automatic Pi correlation are not guaranteed. |
| Optional console history | OS temp directory's `pi-ipython-cells-*/cells.txt`, with cell code, output, and status. | Recorded only in interactive TUI mode with `HERDR_ENV=1`, even while the console is closed. Recording stops at the 16 MiB threshold or on failure. Deleted at extension shutdown. |
| Best-effort checkpoint cache | `~/.cache/pi-ipython/checkpoints/`, with `manifests/<checkpoint-id>.json` and `blobs/<hash>`. `XDG_CACHE_HOME` overrides `~/.cache`. Manifests describe saved/skipped names and blob references, not cell code or output. | Saves run asynchronously and can skip values or fail. Default 30-day age and 2 GiB capacity settings are cleanup rules, not guaranteed retention periods. `PI_IPYTHON_PERSISTENCE=0` or `"persistence": false` in `.pi/pi-ipython.json` disables saves. |

- Resolve session, cache, and output paths explicitly. Sessions default to `~/.pi/agent/sessions/--<encoded-cwd>--/<timestamp>_<session-id>.jsonl`. `PI_CODING_AGENT_DIR` changes the agent base. `--session-dir`, `PI_CODING_AGENT_SESSION_DIR`, or the `sessionDir` setting can select another session location, with the CLI option taking precedence. Keep derivative code/results outside the source tree; hash original files before and after.
- Parse saved JSON/JSONL as data, not through session-loading APIs, which can migrate and rewrite old records. Do not import runner or audit modules: historical auditors may update ledgers, recover reports, or overwrite aggregates at import time. Do not restore checkpoints or unpickle blobs during mining.
- Inventory every requested job and verify the collected census programmatically. Record missing logs, partial files, and inclusion/exclusion rules instead of silently dropping awkward jobs.
- Stream/filter large records before returning them to the parent. Exclude raw prompts, corpus text, and cached variable values from derivative indexes; keep coordinates and hashes for targeted read-back.

Legacy LocalREPL trajectories, `calls.jsonl`, and `result.rlm_calls` are not artifacts produced by this Pi execution path.

## Join real evidence

Read the session header's `id`, `version`, `cwd`, and optional `parentSession`. Within each file, follow entry `id`/`parentId` links to the relevant branch. The raw tree retains branches and pre-compaction records. It is not the model-visible context, which uses the active branch, compaction summaries, and context edits. Preserve session, branch, entry, tool-call, and cell coordinates. `executionCount` is kernel-local, not a global join key.

For direct calls, join assistant content blocks with `type: "toolCall"` by their `id` to `message.role: "toolResult"` records with the same `toolCallId`, on the same branch. Check `name`/`toolName` and retain the exact arguments and result. IPython arguments contain `code`. Results carry `isError` and details such as `status`, `executionCount`, `kernelReset`, `truncated`, and optional `fullOutputPath` and `checkpoint`. Output keeps only the tail after 2,000 lines or 50 KiB. Above 1 MiB of captured output, the runtime interrupts the cell, so a saved capture is not necessarily complete output.

RLM adds `details.children.spawned` and `details.children.completed` for host activity since the previous IPython result. Completed counters include unsuccessful outcomes. Child usage appears in optional `details.nestedUsage` and tool-result `usage` when observed, not necessarily in the gather cell. These are aggregate observations, not child request/response joins. `details.final` appears only for a non-error result whose retained output contains a parseable `[RLM final]` value. Its absence does not prove `rlm.final` was never called. Check saved child `status` (`ok`, `error`, `cancelled`, `timeout`) and `truncated` rather than treating a successful cell as proof of successful children.

For codemode, join the outer script call and result first. `message.nestedCalls.calls` retains nested IDs, names, bounded arguments, statuses, and durations, not individual result bodies. Check `nestedCalls.complete`: records cap at 256 calls, with arguments limited to 8 KiB per call and 32 KiB total. Omitted arguments or calls leave evidence gaps. The supplementary `message.details.calls` can retain call metadata beyond that cap, but argument and error previews are truncated and full results are absent. Use resolved call IDs to correlate overlapping records without double-counting. Unfinished calls can retain placeholder IDs, so do not force an ID join. Nested IPython code and output are not separate session messages. Output survives only where the script exposes it or another source retains it. Explicit `store()` writes can survive in `codemode-store` entries. Nested cells can also add custom `ipython-checkpoint` entries with `data.checkpoint`. Those entries are checkpoint references, not nested-cell transcripts. Neither these references nor direct `details.checkpoint` IDs prove the background save succeeded or that cache files remain available.

- Match entire retained child prompts against instructions plus serialized source packets only when those inputs are available. Count unique packets, unique prompts, successful completions, repeated prompts, and synthesis calls separately.
- Retain candidate request/response joins when correlation IDs are absent or identical prompts repeat. A completion timestamp is not request-start time; rows can reflect concurrent completion order. Multiple cells in one assistant response or codemode script may repeat work before feedback reaches the parent model.
- Current runtime code may be post-fix. Prefer retained evidence for the code that actually executed.

## Test adaptation, not the label

Require an observable **trigger → changed question/source/passage → executed follow-up** chain. Label each chain:

- **Navigation/catalog repair:** resolve scope, ownership, or source identity.
- **Evidence acquisition:** select a new relevant source/passage in response to a finding.
- **Operational recovery:** repair storage or orchestration without changing the scientific question.
- **Interpretive revision:** change a conclusion after comparing evidence.

Distinguish parent-assistant retrieval across stages from actions inside an RLM completion. No within-job follow-up does not prove no cross-stage adaptation. A changed answer to an identical prompt is not a targeted follow-up. Deterministic fixed-packet sweeps may be appropriate but are not result-driven investigation.

## Recovery and claims

- Separate successful reads from successful checkpoint writes. Verify that recovered response prompts contain the complete intended packet; preserve the exact response rather than generating a plausible replacement.
- Do not infer a failure cause from an unmatched request, missing final file, or absent completion row. Logs may record only successful returned calls.
- Inspect usage accounting before discussing tokens, cache savings, or cost. Provider metadata is not independently verified billing; never translate unknown cost into zero.
- Verify state lifetime at three levels: within one completion, across completions in one owner process, and across the whole investigation. LocalREPL, IPython, and the assistant's separate Python tool are distinct.
- Write findings with exact trace coordinates, census boundaries, causal uncertainty, and hash verification. Keep proposed orchestration improvements separate from improvements actually demonstrated by later traces.
