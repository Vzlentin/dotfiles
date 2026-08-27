# Air France GCP reference

Use GCP as a real shared environment. Prefer diagnosis and read-only inspection. Do not turn an investigation into a cloud write.

## Establish context

Before any GCP command:

1. Read the nearest `AGENTS.md`, repository `README.md`, `justfile`, and relevant `env/*.env` or typed configuration.
2. Confirm that the shell is inside `/Users/vzl/Dev/AF` and that direnv loaded `/Users/vzl/Dev/AF/.envrc`.
3. Verify, without printing secrets or tokens:

```bash
printf 'CLOUDSDK_CONFIG=%s\n' "$CLOUDSDK_CONFIG"
gcloud config get-value account
gcloud config get-value project
```

The expected personal setup is:

- `CLOUDSDK_CONFIG=$HOME/.config/gcloud/airfrance`
- account `vadusserre-ext@airfrance.fr`
- default execution and billing project `afkl-odr-n100`
- ADC file under the Air France Cloud SDK directory

Do not use or modify the default or Carrefour Cloud SDK configuration. Do not run `gcloud config set project` as a hidden side effect. Pass `--project` or `--project_id` explicitly when a command must target another project.

The gcloud user login and Application Default Credentials are separate. Test them separately when needed:

```bash
gcloud auth print-access-token >/dev/null
gcloud auth application-default print-access-token >/dev/null
```

Never print, copy, commit, or persist an access token or credential file.

## Project roles

Keep these roles distinct:

- `afkl-odr-n100`: normal DEV execution, quota, Vertex AI, and deployment project.
- `afkl-odr-p300`: production project. Do not target it unless the user explicitly requests production work.
- `afkl-dwhcomcl-p300`: fully qualified source-data project used by OCP queries. Reading a table there does not mean the query job must run there.

Never infer a project from a table name. State both the job project and every source project. If one identity cannot access both data sources, extract them separately under the correct contexts and join the results locally with Python when practical.

## Permission and connectivity diagnosis

For an access failure, isolate the cause before requesting a role:

1. Confirm the Air France account and explicit project.
2. Confirm whether the command uses gcloud credentials or ADC.
3. Run the smallest read-only probe against one known resource.
4. Distinguish CLI-version or command-surface errors from IAM errors.
5. Distinguish VPN/network failures from IAM failures.
6. Report the exact denied permission, resource, identity, and project when available.

Use `gcloud ... --help` or `gcloud help -- ...` before inventing a Vertex command. The installed CLI has previously exposed `gcloud ai-platform jobs` while rejecting `gcloud ai pipeline-jobs`.

When local access is uncertain, give the user one minimal command to run on the authenticated AF laptop. Do not widen the query or request broad IAM roles first.

## BigQuery workflow

If the user asks only for SQL, return SQL and do not execute it.

Before executing a query:

1. Read the repository SQL or Jinja template that defines the intended semantics.
2. Identify table granularity, join keys, date range, and all large source tables.
3. Add usable partition predicates. OCP raw tables require a filter on `DAT_MAJ_DWH`.
4. Do not claim that `LIMIT` reduces bytes scanned.
5. Use fully qualified table names and an explicit job project.
6. Dry-run the final rendered SQL.
7. Report estimated bytes in GiB or TiB and wait for explicit approval before a billable run.
8. After approval, execute with `--maximum_bytes_billed` set slightly above the approved estimate.

Example dry run:

```bash
bq query \
  --project_id=afkl-odr-n100 \
  --use_legacy_sql=false \
  --dry_run \
  < query.sql
```

After approval:

```bash
bq query \
  --project_id=afkl-odr-n100 \
  --use_legacy_sql=false \
  --maximum_bytes_billed="<approved-byte-cap>" \
  < query.sql
```

Do not invent a standard byte cap. Derive it from the dry-run and state it before execution.

Use a direct bounded predicate that permits partition pruning. Match the actual partition type; do not guess it. For example, after verifying a timestamp partition:

```sql
WHERE DAT_MAJ_DWH >= TIMESTAMP('2025-03-01')
  AND DAT_MAJ_DWH <  TIMESTAMP('2025-04-01')
```

Treat an estimate near 8 TiB as a failed optimization, not as acceptable because the SQL is logically correct. Preserve result semantics while reducing scanned partitions and repeated scans. If a safe cross-project query is not possible, stage each minimal result separately and join locally.

After approval, save large results to an approved local or GCS path. Do not commit customer data, extracted rows, Parquet datasets, or generated model artifacts.

## GCS, Vertex AI, GAR, and Cloud Run

Read-only listing, description, status, and log inspection are acceptable when they are needed for the task. Use explicit project and region flags.

Obtain explicit approval before any of these actions:

- upload, copy, move, overwrite, or delete GCS objects
- submit or cancel Vertex AI jobs or pipelines
- start costly training
- build or push container images
- change Artifact Registry content
- deploy, update, roll back, or delete Cloud Run services
- dispatch deployment or training workflows

Prefer repository commands and workflows over hand-built cloud commands. In `coreai-saas-seatreco`, inspect the `justfile`, `env/dev.env`, and typed environment configuration first. Do not assume that a local download path is visible to Vertex AI; determine whether the job needs a GCS object and which service account reads it.

Before an approved mutation, show:

- action and exact command or workflow
- target project, region, resource, and environment
- identity or service account
- expected input and output locations
- cost or blast-radius concern
- rollback or recovery path when applicable

Afterward, verify the resulting resource state. Do not claim success from command exit status alone.

## Response format

For investigations, report:

1. active account, job project, and source project
2. read-only checks performed
3. likely cause, with evidence
4. exact next command or SQL
5. estimated cost and partition coverage, when relevant
6. cloud writes not performed and approval still required
