---
name: gcp
description: Safely inspect or operate Google Cloud resources. Use for gcloud, BigQuery/bq, ADC, IAM, GCS, Cloud Run, Vertex AI, Firestore, Secret Manager, logs, deployment, authentication, or real-data work.
compatibility: Requires the Google Cloud CLI. Client workspaces usually configure it with direnv.
---

# Google Cloud

Treat every cloud environment as real and shared. Default to diagnosis and read-only inspection. Never turn an investigation into a mutation or workflow execution without explicit approval.

## Select the context

Before running a GCP command:

1. Identify the repository or resource target from the user's request and resolve its absolute path.
2. Run `pwd -P` and, when applicable, `git rev-parse --show-toplevel`.
3. If the target workspace has an `.envrc`, run commands through it with `direnv exec <workspace> <command>`. Do not rely on the ambient environment when Pi started outside the workspace.
4. Check the active account, project, `CLOUDSDK_CONFIG`, ADC, and impersonation with `gcloud config list` and `gcloud auth list`. Stop if they do not match the target.
5. If the context is ambiguous, stop and ask which one to use.

Select the context from the target workspace, not from a project ID, table name, remembered session, or whichever credentials happen to work. Never combine identities, configuration, or project defaults from different workspaces in one shell.

## Boundary

- Never print tokens, secret payloads, credentials, customer data, or complete production records.
- Prefer explicit project, region, location, resource, and identity arguments over ambient defaults. Do not run `gcloud config set` as a hidden side effect.
- Dry-run BigQuery SQL before execution and inspect partition filters and scan scope.
- A request for SQL text does not authorize query execution.
- Ask before running a billable query.
- Cloud writes, deployments, job execution, IAM changes, and end-to-end workflows require explicit approval.
- Report the active identity, billing project, target project or resource, read/write classification, cost or capacity concern, and operations not performed.
