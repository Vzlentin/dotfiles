# Research: DSPy and GEPA as the learning substrate

**Ticket:** Vzlentin/dotfiles#8 — *Research DSPy and GEPA as the learning substrate*
**Parent:** Vzlentin/dotfiles#4 — *Design the adaptive graph orchestration framework*
**Access date:** 2026-07-19
**Method:** PyPI versioned metadata, wheel source inspection of `dspy-3.2.1` and
`gepa-0.1.4` (all API claims below were verified against package source, not prose
docs), arXiv metadata for the GEPA paper, MLflow docs for DSPy tracing.

## Versions inspected

| Package | Version | Notes |
|---|---|---|
| `dspy` | 3.2.1 | `requires_python >=3.10,<3.15`; depends on `gepa[dspy]==0.0.27` (pinned!) |
| `gepa` (standalone, gepa-ai/gepa) | 0.1.4 | pre-1.0; core `optimize()` is dependency-light, `full` extra pulls litellm/mlflow/wandb/datasets |
| `mlflow` | 3.14.0 | for `mlflow.dspy.autolog()` tracing reference |

Important version detail: DSPy 3.2.1 pins `gepa[dspy]==0.0.27`, while the standalone
`gepa` package has moved to 0.1.x (0.1.4). The standalone 0.1.x line has a richer API
(multi-objective scores, frontier types, acceptance criteria, resume-from-state,
`optimize_anything`) than the 0.0.27 build DSPy embeds. **A framework that pins DSPy
must not assume it can freely mix standalone gepa 0.1.x with `dspy.GEPA` without
testing the version seam.** Using GEPA directly (bypassing `dspy.GEPA`) is a first-class
supported path and avoids this conflict.

## The GEPA paper

*GEPA: Reflective Prompt Evolution Can Outperform Reinforcement Learning*
(Agrawal et al., arXiv:2507.19457, published 2025-07-25). Reports GEPA outperforming
GRPO by 6% on average (up to 20%) across six tasks while using up to 35x fewer
rollouts, and outperforming MIPROv2 by over 10%. Claims are paper-side; treat as directional
evidence that reflective evolution is sample-efficient, not as a guarantee for our
Actor Programs.

## Verified DSPy capabilities (3.2.1, wheel source)

### Typed Actor Programs

- `dspy.Signature` is a pydantic `BaseModel` subclass (`Signature(BaseModel,
  metaclass=SignatureMeta)`). Fields carry real Python/pydantic types — `str`,
  `List[str]`, `Literal[...]`, custom pydantic models — plus `desc` metadata.
  Adapters (Chat/JSON) enforce typed outputs; rich types live in `dspy.adapters.types`
  (Tool, Image, History, Code, Document, Citation...).
- `dspy.Module` composes predictors (`Predict`, `ChainOfThought`, `ReAct`, custom
  `forward`). This maps cleanly onto an **Actor Program**: typed interface (Signature)
  + internal orchestration (Module).

**Fit:** an Actor Role can own a DSPy Module; its Signature is the typed contract the
deterministic control plane can validate without DSPy involvement.

### Candidate persistence / promotion mechanics

- `Module.save(path)` / `Module.load(path)`:
  - `.json` state-only save (verified in `base_module.py`) — safe, portable,
    diff-able. **This is the right serialization for versioned Actor Program
    candidates.**
  - `save_program=True` uses cloudpickle; DSPy itself warns it can run arbitrary code
    on load (`allow_pickle=False` by default, explicit warning logged). **Reject
    pickle as the candidate format.**
  - Saved state embeds `metadata["dependency_versions"]`; `load()` warns on
    DSPy/dependency version mismatch. Useful but only a warning — the framework must
    pin versions itself.
  - `load(..., allow_unsafe_lm_state=False)` by default scrubs LM endpoint keys
    (`api_base`, `base_url`, `model_list`) — good for local-first privacy; a promoted
    candidate does not silently smuggle a remote endpoint.

### Trace capture

- `DSPyTrace` = list of `(predictor, inputs, outputs)`; GEPA's DSPy adapter consumes
  it directly and can slice per-predictor sub-traces (`pred_name`, `pred_trace`).
- `dspy.utils.callback.BaseCallback` gives `on_lm_start/on_lm_end`,
  `on_module_start/on_module_end`, etc. — a supported hook for the framework to pipe
  execution traces into its own **Actor Attempt** trace store without MLflow.
- `dspy.utils.usage_tracker` tracks per-LM token usage within a context manager —
  usable for per-attempt cost accounting.
- `dspy.inspect_history` exists but is a debugging aid, not a capture substrate.
- MLflow: `mlflow.dspy.autolog()` (mlflow 3.x) traces DSPy execution; MLflow can run
  fully local (file/SQLite tracking URI). Optional, not required.

### Offline evaluation

- `dspy.Evaluate(devset, metric, num_threads, failure_score, save_as_csv/json, ...)`
  — parallel offline evaluation with per-example results and traceback capture. Fully
  local except for LM calls.

### Optimization (teleprompters)

Full roster in `dspy/teleprompt/`: `GEPA`, `MIPROv2`, `SIMBA`, `BootstrapFewShot*`,
`BootstrapFinetune`, `GRPO`, `COPRO`, `InferRules`, `KNNFewShot`, `BetterTogether`,
`Ensemble`. GEPA is the reflective-trace optimizer we care about; the others confirm
DSPy is a general optimization substrate if GEPA underperforms.

## Verified GEPA capabilities

### Via `dspy.GEPA` (DSPy 3.2.1, wraps gepa engine)

- Marked `@experimental(version="3.0.0")` — the API is explicitly unstable.
- Constructor (verified): `metric` with feedback protocol, budget via
  `auto={"light","medium","heavy"}` (n=6/12/18), `max_full_evals`,
  `max_metric_calls`; `reflection_lm` (a strong reflection model is recommended);
  `candidate_selection_strategy={"pareto","current_best"}`; `use_merge=True`,
  `max_merge_invocations`; `component_selector="round_robin"` (per-predictor
  optimization — exactly what we want for optimizing one predictor of an Actor
  Program); `log_dir`, `track_stats`, `track_best_outputs`, wandb hooks.
- **Feedback metric protocol** (verified): the metric receives `(gold, pred, trace,
  pred_name, pred_trace)` and returns a float or `{score, feedback}`. Textual feedback
  at predictor granularity steers reflection. This is the key integration seam: our
  evaluators must emit feedback, not just scores.
- `compile()` returns an optimized Module with `detailed_results: DspyGEPAResult`:
  all candidates, parent lineage, per-candidate validation aggregate + per-instance
  subscores, per-val-instance best candidate sets (the Pareto frontier),
  `discovery_eval_counts`, `total_metric_calls`, `log_dir`, `seed`. Also serializable
  via `to_dict()`.
- Documented inference-time search usage: pass `valset=trainset`,
  `track_best_outputs=True` and read the Pareto frontier of a batch.

### Via standalone `gepa.optimize()` / `gepa.optimize_anything()` (0.1.4)

Verified in `gepa/api.py`, `gepa/core/*`, `gepa/strategies/*`:

- **System-agnostic.** A candidate is `dict[component_name -> component_text]`; the
  framework implements `GEPAAdapter` (`evaluate`, `make_reflective_dataset`, optional
  proposal fn). `optimize_anything` optimizes any text artifact — prompts, code,
  policies, configs — with three modes (single-task search, multi-task batch,
  generalization) and a seedless mode. **This is the escape hatch for Actor Programs
  that are not DSPy modules** (e.g. plain prompt+manifest Actor Programs).
- **Pareto / multi-objective:** candidate selectors `pareto`, `current_best`,
  `epsilon_greedy`, `top_k_pareto`; `frontier_type={"instance","cartesian"}`;
  `EvaluationBatch.objective_scores` (per-example objective name → score maps) with
  `per_objective_best_candidates` and `objective_pareto_front` in state/result.
  Multi-objective evaluation is real in 0.1.x — but note the DSPy-embedded 0.0.27 may
  not expose all of it.
- **Reproducibility knobs:** `seed` parameter; `GEPAState.save(run_dir)` /
  `GEPAState.load(run_dir)` with atomic JSON writes; **resume**: if `run_dir` already
  contains state, `optimize()` resumes from the last saved state; `FileStopper`
  (touch `gepa.stop` in run_dir) for graceful shutdown; `cache_evaluation=True`
  evaluation cache keyed by candidate hash; `use_cloudpickle` option for non-JSON-safe
  state (avoid). Adapter state can round-trip via `get_adapter_state` /
  `set_adapter_state`.
- **Budget governance:** `max_metric_calls`, `max_reflection_cost`,
  `stop_callbacks` — hard, machine-checkable optimization budgets. Maps directly onto
  campaign-level learning budgets.
- **Acceptance discipline:** `acceptance_criterion={"strict_improvement",
  "improvement_or_equal"}` — candidate proposals are only accepted into the
  population on measured improvement, which matches our Human Gate story.
- **Logging:** pluggable `LoggerProtocol`, callbacks, optional wandb/mlflow trackers
  (both attachable to externally-owned runs). All can be pointed at local stores.
- Pre-built adapters shipped: default, DSPy (component-level), **DSPy full-program**
  (evolves whole DSPy program source via a proposal signature — powerful but it
  mutates code, not just prompts; treat as future fog, not initial scope), generic
  RAG, LangChain, MCP, terminal-bench.

## What DSPy/GEPA own vs. what the framework owns

### DSPy/GEPA own (verified)

- Typed Actor Program definition (Signatures/Modules) and safe candidate
  serialization (JSON state).
- Reflective candidate generation with textual feedback, per-component optimization.
- Pareto-frontier candidate sets, lineage, per-instance subscores.
- Optimization budgets, seeds, run resumption, graceful stop.
- Offline evaluation machinery (`dspy.Evaluate`, GEPA valset policies).
- Trace capture hooks (callbacks, usage tracker, DSPyTrace).

### The framework owns (not in DSPy/GEPA)

- **Actor Program identity and versioning.** GEPA returns candidate dicts and scores;
  assigning content-addressed Actor Program versions, storing candidates in the
  manifest store, and pinning them to Graph Revisions is ours. GEPA's `run_dir` is a
  scratch space, not a registry.
- **Shadow deployment.** Neither library has any deployment concept. The Supervisor
  must run candidate Actor Programs in shadow mode alongside the pinned production
  version, route identical inputs to both, and collect comparative Actor Attempt
  traces. GEPA's offline valset evaluation is the closest primitive and is *offline
  only* — live shadow traffic is framework infrastructure.
- **Promotion and rollback.** Selecting a candidate off the Pareto frontier, passing
  it through a Human Gate, atomically rebinding an Actor Role to a new Actor Program
  version, and rolling back are all control-plane operations. GEPA deliberately stops
  at "here is the frontier and the best index".
- **The deterministic control plane.** DSPy settings are global (`dspy.settings`,
  thread-local-ish context) — the learning runtime must run in an isolated
  process/service so optimizer state, LM config, and caches can never mutate the live
  control plane. Campaigns keep pinning Graph Revision + Actor Program versions; DSPy
  only ever sees a student copy.
- **Evaluator design.** GEPA needs metrics that emit rich textual feedback per
  predictor. Translating Human Gate verdicts, campaign outcomes, and review signals
  into `ScoreWithFeedback` is our hardest owned problem (reward hacking included).
- **Trace/eval data governance.** The trace store, redaction policy, and the decision
  of what a reflection LM ever sees are ours (see privacy below).
- **Dataset curation.** GEPA consumes trainset/valset; turning historical Actor
  Attempts into curated, deduplicated, leakage-free train/val splits is framework
  work (and a precondition for trustworthy promotion).
- **Cross-run experiment registry.** GEPA results are per-run objects; comparing
  candidates across runs, campaigns, and Graph Revisions is ours.

## Privacy: what leaves the machine

Verified from dependencies and call paths:

- **Task LM calls** — whatever the Actor Program sends, via litellm. Fully local iff
  the configured model is local (litellm supports ollama/llamacpp endpoints).
- **Reflection LM calls** — GEPA's reflection prompt includes component text, traces,
  and evaluator feedback from *private Actor Attempts*. **This is the largest privacy
  surface**: a hosted reflection model exfiltrates curated traces by design. Mitigation:
  local reflection model, or framework-side redaction before the adapter hands traces
  to GEPA (the `GEPAAdapter.make_reflective_dataset` seam gives us exactly this
  control).
- **litellm** itself is pass-through (no telemetry), but model-provider data
  retention is provider policy — outside our control once bytes leave.
- **Optional trackers:** wandb is cloud by default (must stay off or self-hosted);
  MLflow can be local-file; GEPA's `run_dir` and DSPy's disk cache
  (`diskcache`, in `~/.dspy` or configured cache dir) are local.
- DSPy's saved JSON state excludes endpoint keys unless `allow_unsafe_lm_state=True`
  — keep the default.

Conclusion: a fully local configuration is achievable (local task LM + local
reflection LM + no wandb + local run dirs), but nothing in DSPy/GEPA *enforces* it.
Enforcement (model allowlists per Actor Role, redaction) is framework policy.

## Version and reproducibility risks

1. **DSPy pins `gepa[dspy]==0.0.27`** while standalone gepa is 0.1.4 — the two lines
   can conflict in one environment. Isolate the learning runtime in its own venv and
   pick one integration path (initially: `dspy.GEPA` for DSPy-native Actor Programs;
   evaluate standalone `gepa.optimize` for non-DSPy ones later).
2. **`dspy.GEPA` is `@experimental`** — API churn across DSPy minors is likely; pin
   `dspy==x.y.z` per candidate and record it in the candidate's metadata (DSPy's own
   version-mismatch warning on load reinforces this).
3. **GEPA is pre-1.0** (0.1.4) — state serialization has already gone through schema
   migrations (`_VALIDATION_SCHEMA_VERSION`, legacy v0 upgraders in source). Do not
   treat `run_dir` contents as a durable format; export candidates into our own
   registry promptly.
4. **Seeds don't give full reproducibility.** `seed` controls GEPA's sampling, but
   LLM nondeterminism (temperature, provider drift, local-model quantization) means
   identical seeds can yield different candidates. DSPy's response cache
   (`cache=True`, `rollout_id` semantics) helps replay within a run but is not a
   cross-run determinism guarantee. Treat candidate artifacts + their recorded
   eval scores as the reproducible unit, not the optimization run.
5. **Score comparability across runs** is only valid for identical valset, metric
   code, and model versions — the framework must hash all three into any comparison.
6. **GEPA full-program adapter mutates code** — if ever used, candidates are
   executable source, requiring sandboxed evaluation; out of initial scope.

## Newly visible decisions / fog

- **Decision: integration path.** Start with `dspy.GEPA` + JSON state save/load for
  DSPy-native Actor Programs; keep standalone `gepa.optimize_anything` as the adapter
  seam for non-DSPy Actor Programs. (Recommended; needs ratification.)
- **Decision: candidate format.** Actor Program version = manifest reference + DSPy
  JSON state (+ prompt components for non-DSPy). Never pickle. (Recommended.)
- **Decision: learning runtime isolation.** Separate process + own venv + own
  `dspy.settings` context; communicates with the Supervisor via the trace/eval store,
  never shared memory. (Recommended.)
- **Fog: feedback metrics.** How Human Gate outcomes and review signals become
  per-predictor textual feedback without reward hacking — needs the evaluation
  governance work (blocked-by relationship to eval-governance tickets).
- **Fog: reflection model choice.** Local reflection models are significantly weaker;
  whether a local model suffices for useful reflection is an empirical prototype
  question, and it gates the privacy story.
- **Fog: dataset economics.** GEPA's sample efficiency claims assume decent
  train/val sets; how many curated Actor Attempts we realistically have per Actor Role
  is unknown until the trace store exists.
- **Fog: learned topology/policy optimization.** `optimize_anything` makes graph
  topology and control-policy *text* optimization technically possible later, but the
  parent issue already reserves this behind shadowing + Human Gates; no new action.
