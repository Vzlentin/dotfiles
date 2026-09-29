# Examples

Real drafts the user rejected or accepted. Names, clients, and internal identifiers are changed.

## What the feedback means

| Feedback | Fix |
|---|---|
| too dry | The draft is fragments. Join them into short sentences that keep the reason. |
| too much, too dense, chunky, bloated | Cut to what the reader acts on. One idea per line. |
| too ai, trying too hard, not human | Remove openers, labels, framing, and bold. |
| unclear, confusing, talk normally | Say the concrete consequence in plain words. |
| don't breadcrumb | Remove history and process. State the result. |
| not usable | Show where the comment goes, with the file, line, and code. |

## Review reply

Rejected:

> Good point. I replaced `_adj` and `_node` with NetworkX's public `.adj` and `.nodes` views.
>
> I reran the same 15-scenario benchmark:
> - Original implementation: 201.33 µs/call
> - Optimized with private attributes: 14.55 µs/call
> - Optimized with public views: 28.24 µs/call
>
> The public views add some overhead, but we still get a 7.1× speedup over the original without depending on private attributes. All 724 tests pass.

Accepted:

> Replaced the private attributes with public .adj and .nodes views. Now 28 µs per call instead of 15 µs, still 7x faster than the original 201 µs. All 724 tests pass.

## Review body

Rejected as "trying too hard":

> Direction is good. Two things before merge.
>
> Ownership. The exception lives on the shared feature, keyed by model id strings. That makes features depend on models, duplicates ids a rename would silently break, and pushes model_id into the validator. Move it to the model: `ClassVar[Mapping[str, frozenset[str]]]` keyed by feature name. [...]
>
> Scope. Title says validation but [...]
>
> Deriving allowed_values from the enums is good, keep it.

Posted, after "Two things." and "Details inline." were removed from the second draft:

> The missing values map belongs on the model, not on the feature. Right now the shared features hardcode model ids and the validator takes a model_id. Put the map on the model definition, keyed by feature name, and pass the set to the validator.
>
> The extractor changes change serving output, not just validation. Collapsing two enum values affects trained models. Separate PR, or say so in the description and check against what is deployed.

## PR comment

Rejected as "unclear" and "too much":

> this compares values before normalizing their types. i reproduced these results with pandas 1.5.3
>
> ```text
> same datetime as naive and UTC
> raw mismatch: true
> normalized delta: 0
> ```
>
> can we normalize timestamps to UTC and compare floats with an agreed tolerance before building the mismatch selector

Accepted:

> this can report false mismatches. i reproduced it with equivalent datetimes using different timezone types and floats differing by `5.55e-17`. can we normalize timestamps and use a float tolerance before comparing

## Dense reply

Rejected as "too dense":

> not about importing. `from __future__` has to be the first statement of a file, so the .py export is a SyntaxError at line 205 and flake8 flags F404 with our pre-commit config. the other exports all compile. the trainer cell only uses List/Dict/-> None so the line is unused on 3.10+, just delete it. not blocking

Posted, after "not blocking" was removed:

> not about importing.
>
> `from __future__` has to be the first statement of the file, so the .py export is a SyntaxError at line 205. flake8 flags it as F404. the other three exports in this folder compile.
>
> the line is unused, just delete it.

## Message to another team

Rejected as "doesn't sound human at all":

> Hi, I checked the partner logs. They are sufficient to identify the timeout windows, but not to determine reliably which model was selected.
>
> Could they provide the request payload—or, minimally, the `visitorId`—for each of the four calls? Ideally, we should also get the target environment/endpoint and the response headers if available. [...]

Accepted:

> What they shared isn't quite enough to identify the model. Could they also send us the `visitorId` for each of those four requests? That should let us match them in our logs and see which model was used. We don't need the full request payload.

## French reply

Rejected as too long, and because nobody says "transcodification":

> J'ai vérifié la table de transcodification actuelle en lecture seule. Elle contient 100 formats non nuls. Aucun format n'est associé à plusieurs `chain_key`.
>
> Je propose néanmoins de conserver le `COUNT(DISTINCT ...)`. Il couvre aussi une transcodification absente, qui doit produire une incohérence bloquante.

Posted, with "je propose de garder" instead of "je garde":

> Non, pas dans la table actuelle : chaque format correspond à une seule `chain_key`. Je propose de garder le contrôle pour détecter un format sans `chain_key`.

## Question to a colleague

Asked for "simple, topline, pas breadcrumbée, juste brute":

> Un article est-il éligible uniquement s'il a à la fois un stock positif dans au moins un magasin et une activité de vente, positive ou négative, sur les six derniers mois, ou un seul de ces deux critères suffit-il ?

## Replies the user dictated

- agreed, fixed the ugly import pattern and added a todo
- I think this should be a separate ticket
- this has been covered in a subsequent PR, closing this now
- Oui. 27 clés sur 22 175 correspondent à deux libellés distincts. La sélection reste correcte car elle utilise la clé, mais ANY_VALUE rend le libellé affiché non déterministe.

## PR description

The user gave this as the target style:

> Prepare a notebook for the analysis of the upcoming A/B test.
>
> We do not know the final experiment setup yet, so the notebook does not assume campaign or experiment IDs, dates, event names, filters, or dashboard values. It runs on synthetic data for now.
>
> The notebook:
> - extracts one row per visitor using first-decision A/B attribution
> - dry-runs the BigQuery query before allowing a billable execution
> - first reconciles the results with the experiment dashboard
> - then compares the two arms overall and on pre-treatment segments
>
> The Python and HTML exports are included. No BigQuery query was run and there are no experiment results yet.

## Code comments

Rejected with "why would you comment ponytail ew". The skill tag had to go:

```ts
// ponytail: latest report wins, so a 5s heartbeat beats the stock idle report; flickers briefly after each chat turn
```

Rejected as "very confusing". The fix named the two document shapes in plain words and said that the fallback prevents a second send:

```python
# Keep consulting legacy fields after destination-aware tracking starts:
# an older destination may exist only in the legacy pair.
```

The user's model for a comment on a deliberate shortcut:

```python
# global lock, per-account locks if throughput matters
```

Other corrections:

- "you commented in french in a english commented notebook"
- "do not mention <colleague> anywhere in the notebook"
