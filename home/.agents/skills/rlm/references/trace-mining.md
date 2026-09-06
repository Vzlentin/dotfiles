# Read-only RLM trace mining

## Durable evidence locations

- Later instruction work is recorded in `~/.local/share/librlm/experiments/20260906-trace-lessons/` and `20260906-decision-pilot/`. These contain line-hashed lessons, reviewed parent decision anchors and bounded development comparisons. The original parent already requested a bounded evidence pass; fixed downstream worker instructions do not prove that every sweep was unnecessary. The prompt trials did not establish broad research improvement. Read these only when mining or evaluating instructions, not as task instructions for an unrelated investigation.

- The 18 preserved Hermes Calibre derivative artifacts (including `assessment.md`), `handoff.md`, original `rlm-trace-mining-0uubfn7d.zip`, and `registry.json` live in `~/.local/share/librlm/traces/hermes-calibre-20260906-mined/`. Start with the registry, assessment, and handoff; the registry records derivative hashes, the archive hash, and the original cache at `/home/vzl/.hermes/cache/calibre-research-rlm-20260906`.
- The Mac collection and its provenance live in `~/.local/share/librlm/traces/mac-20260906/`. Read `split-manifest.json` before selecting episodes; `assessment.md` records the collection findings. A remote checkout's current commit or current tool-description hash does not establish which instructions a historical session loaded.
- Treat `/tmp/rlm-trace-mining-handoff.md`, `/tmp/rlm-trace-mining-0uubfn7d/`, and the original Mac paths recorded in manifests as historical provenance. Use the durable copies for ongoing work. Preserve original source paths and hashes in forensic records; do not rewrite or replay original research caches to make paths current.

## Split whole investigation families

- Assign an entire connected investigation to one split, using `leakageGroup`. Keep related parent sessions, child calls, retries, checkpoint repairs, summaries, and copied excerpts together. Different jobs, machines, filenames, or timestamps do not prove independence; do not randomly split individual calls from the same family.
- The Hermes registry assigns `hermes-calibre-investigation-20260906` to `trainingDevelopment`. Treat its linked jobs and mined derivatives as one family, not independent training and test examples.
- The Mac manifest reserves the related `mac-vault-client-investigation-20260905` sessions as `heldOut` and quarantines a session that may contain derived excerpts. Neither `heldOut` nor `quarantine` content may enter GEPA optimization, reflection, prompt design, or candidate selection. `unassigned` episodes are also ineligible until an independence and leakage audit records their assignment.
- Freeze the candidate and evaluation criteria before opening held-out content for final evaluation. Record any exposure or discovered cross-family link and revise the split's contamination status before claiming generalization. Do not quietly relabel exposed examples as independent held-out evidence.

## Collect without replay

- Resolve cache and output paths explicitly. Keep derivative code/results outside the source tree; hash original files before and after.
- Parse saved JSON/JSONL as data. Do not import runner or audit modules: historical auditors may update ledgers, recover reports, or overwrite aggregates at import time.
- Inventory every requested job and verify the collected census programmatically. Record missing logs, partial files, and inclusion/exclusion rules instead of silently dropping awkward jobs.
- Stream/filter large records before returning them to the parent. Exclude raw prompts, corpus text, and `result.locals` from derivative indexes; keep coordinates and hashes for targeted read-back.

## Join real evidence

- Classify root calls by exact trajectory prompt **and** response matches. Match children against recorded `result.rlm_calls` and completion messages/responses. A REPL fence alone is not a reliable classifier.
- Preserve job, iteration, code-block, and child-slot coordinates. Multiple query cells in a single root response may repeat work before any feedback reaches the root.
- Inspect actual schemas: historical `calls.jsonl` stores the message list in `prompt`, whereas request files may store it in `messages`.
- Match entire child prompts against instructions plus serialized source packets. Count unique packets, unique prompts, successful completions, repeated prompts, and synthesis calls separately.
- Retain candidate request/response joins when correlation IDs are absent or identical prompts repeat. A completion timestamp is not request-start time; rows can reflect concurrent completion order.
- Current runner code may be post-fix. Prefer trajectory/history evidence for the code that actually executed.

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
