# Carrefour GCP reference

Use Carrefour GCP as a real client production environment. Default to diagnosis and read-only inspection. Never turn an investigation into a write or workflow execution without explicit user approval.

## Safety boundary

You may do these without additional approval:

- inspect local configuration;
- validate authentication without printing tokens;
- list or describe resources;
- read logs narrowly;
- dry-run BigQuery SQL;
- execute a bounded BigQuery `SELECT` after checking its partition filters and estimated bytes. Carrefour uses slot-based billing rather than per-byte billing, so this read-only exception does not require separate approval; still protect shared slot capacity and stop on an unexpectedly broad scan.

Get explicit approval before:

- BigQuery DDL or DML, query materialization, exports, or scheduled-query changes;
- Firestore, GCS, Sheets, Gmail, Secret Manager, or IAM writes;
- Cloud Run deployment, update, invocation, job execution, or traffic changes;
- Pub/Sub publication, BPM calls, MDM delivery, or any end-to-end workflow execution;
- changing the active account, project, ADC, or service-account impersonation.

Never print access tokens, secret payloads, credentials, customer data, or complete production records. Never save production workbooks or query output in a repository. Use a uniquely named `/tmp` directory when temporary real data is necessary, and delete it after recording a non-sensitive summary.

## Start with the Carrefour environment

Work below `/Users/vzl/Dev/CF` so direnv loads the client-scoped configuration. Do not mutate the global gcloud configuration.

Run this preflight before remote work:

```bash
printf 'cwd=%s\n' "$PWD"
printf 'config=%s\naccount=%s\nproject=%s\nimpersonation=%s\n' \
  "${CLOUDSDK_CONFIG:-}" \
  "${CLOUDSDK_CORE_ACCOUNT:-}" \
  "${CLOUDSDK_CORE_PROJECT:-}" \
  "${CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT:-}"

gcloud config get-value account
gcloud config get-value project
gcloud auth application-default print-access-token >/dev/null
command -v bq
```

Expected local defaults are:

```text
CLOUDSDK_CONFIG                       ~/.config/gcloud/carrefour
CLOUDSDK_CORE_ACCOUNT                 valentin_dusserre@ext.carrefour.com
CLOUDSDK_CORE_PROJECT                 vg1np-apps-cpo-dev1-c0
CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT
                                      promo-tenders-cloudrun-sa@vg1np-apps-cpo-dev1-c0.iam.gserviceaccount.com
GOOGLE_APPLICATION_CREDENTIALS        $CLOUDSDK_CONFIG/application_default_credentials.json
```

If they differ, stop and report the mismatch. First suggest `direnv reload`. Do not run `gcloud auth login`, `gcloud auth application-default login`, `gcloud config set`, or clear impersonation unless the user explicitly asks to repair authentication.

Do not silently bypass an authorization failure with:

```bash
CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT=
```

That changes the acting principal. Explain the failure and ask before switching identity.

## Keep project roles explicit

The default billing and execution project is the Carrefour CPO development project:

```text
vg1np-apps-cpo-dev1-c0
```

Resources used in past work include:

```text
fr-darwin-prd                         production Darwin reference reads
vg1p-apps-cpo-prd2-ca                production promo-tenders data reads
vg1p-apps-ctrlprom-prd-12            production control-promo integration
vg1np-apps-afreport-dev-1d            development reporting/materialization
```

Treat these as orientation, not a current contract. Confirm project and dataset identifiers in the current repository configuration or `$VAULT` before use. A production source project is read-only unless the user explicitly approves a write.

Always pass the billing project and location instead of relying on ambient defaults:

```bash
--project_id="${CLOUDSDK_CORE_PROJECT}" --location=EU
```

## BigQuery workflow

If the user asks only for SQL, return SQL and do not execute it.

Use GoogleSQL and fully qualified table names. Before every execution:

1. Classify the statement. Stop for approval unless it is only `SELECT`.
2. Inspect partition predicates, date ranges, joins, and unbounded scans.
3. Dry-run the exact SQL with the same parameters and billing project.
4. Report estimated bytes and whether partition pruning is present.
5. For a bounded `SELECT`, execute with `--maximum_bytes_billed` set slightly above the dry-run estimate.
6. Add a useful `LIMIT` when inspecting rows, but do not claim that `LIMIT` reduces bytes scanned. Prefer aggregates and selected columns over `SELECT *`.

The bounded-`SELECT` exception is specific to Carrefour's slot-based billing. It does not authorize writes, broad scans that can consume shared slot capacity, or query execution when the user requested SQL text only.

Put non-trivial SQL in a temporary file to avoid shell-quoting mistakes:

```bash
SQL_FILE=$(mktemp /tmp/carrefour-bq.XXXXXX.sql)
# Write the proposed SQL to "$SQL_FILE".

bq query \
  --project_id="${CLOUDSDK_CORE_PROJECT}" \
  --location=EU \
  --use_legacy_sql=false \
  --dry_run \
  < "$SQL_FILE"
```

Only after reviewing the estimate:

```bash
bq query \
  --project_id="${CLOUDSDK_CORE_PROJECT}" \
  --location=EU \
  --use_legacy_sql=false \
  --maximum_bytes_billed="<dry-run-byte-cap>" \
  --format=prettyjson \
  < "$SQL_FILE"

rm -f -- "$SQL_FILE"
```

Do not invent a standard byte cap. Derive it from the dry-run and state it before execution. Do not append full production output to the vault or repository; summarize results and keep only approved, minimized artifacts.

A dry-run does not authorize a write. `CREATE`, `REPLACE`, `INSERT`, `UPDATE`, `DELETE`, `MERGE`, `EXPORT`, and procedure calls still require explicit approval before real execution.

## Real-data validation

For promo-tenders replay, preserve this boundary unless the user explicitly changes it:

```text
Real and read-only
  Drive downloads
  BigQuery SELECTs against required reference data

Faked or bypassed
  Firestore
  Gmail and Sheets writes
  BigQuery inserts and MDM writes
  GCS writes and status logging
  BPM execution
```

Use the maintained runbook instead of reconstructing the procedure from session history:

```text
$VAULT/promo-tenders/runbooks/real-ao-replay.md
$VAULT/promo-tenders/runbooks/real-ao-replay-manifest.tsv
$VAULT/promo-tenders/runbooks/scripts/validate_real_aos.py
```

Abort immediately if a replay reports:

```text
FIRESTORE_CLIENT_INITIALIZED True
```

Production Drive access uses the separately authenticated `gws` CLI, not `gcloud`. Keep downloads under a guarded `/tmp` path and remove them after validation.

## Other GCP services

For Cloud Run, IAM, Firestore, GCS, Secret Manager, and logs:

- begin with `list`, `describe`, or a narrow read;
- state the project, region, resource name, and acting identity;
- inspect repository Terraform and CI before proposing an imperative change;
- prefer a repository change and reviewed deployment path over `gcloud ... update`;
- do not reveal Secret Manager values—inspect metadata and versions only;
- constrain log queries by service, region, severity, and time range;
- do not invoke services merely to test connectivity.

For local containers, mount ADC read-only at runtime. Never copy ADC into the Docker build context or repository. In Cloud Run, use the attached workload identity rather than local credential files.

## Report each operation

Before a remote command, state:

```text
identity | billing project | target project/resource | read/write | expected cost/side effect
```

Afterward, report what ran, the observed scope or bytes processed, and any artifact created or deleted. If a command was not run because approval was missing, say so plainly.
