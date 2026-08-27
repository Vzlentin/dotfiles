---
name: gcp
description: Safely inspect or operate Google Cloud resources for Air France or Carrefour. Use for gcloud, BigQuery/bq, ADC, IAM, GCS, Cloud Run, Vertex AI, Firestore, Secret Manager, logs, deployment, authentication, or real-data work. Selects the client procedure dynamically from the target path and client-scoped direnv environment.
compatibility: Requires direnv and the Google Cloud CLI. Client environments are configured under /Users/vzl/Dev/AF and /Users/vzl/Dev/CF.
---

# Google Cloud

Treat every cloud environment as real and shared. Default to diagnosis and read-only inspection. Never turn an investigation into a mutation or workflow execution without explicit approval.

## Select the client context

Before reading client details or running a GCP command:

1. Identify the repository or resource target from the user's request and resolve its absolute path.
2. Run `pwd -P` and, when applicable, `git rev-parse --show-toplevel`.
3. Select exactly one context:
   - For a target under `/Users/vzl/Dev/AF`, read [references/air-france.md](references/air-france.md).
   - For a target under `/Users/vzl/Dev/CF`, read [references/carrefour.md](references/carrefour.md).
4. If the target is outside both workspaces or is ambiguous, stop and ask which client context to use.
5. Verify the client-specific `CLOUDSDK_CONFIG`, account, project, ADC, and impersonation settings described in the selected reference. Stop on a mismatch.

Select the context from the target workspace, not from a project ID, table name, remembered session, or whichever credentials happen to work. Never combine identities, configuration, project defaults, or procedures from both references.

If Pi started above or outside the target client directory, do not rely on its ambient environment. Run commands through the applicable client environment, for example:

```bash
direnv exec /Users/vzl/Dev/AF <command>
direnv exec /Users/vzl/Dev/CF <command>
```

Use only the command for the selected client. Do not source both `.envrc` files in one shell.

## Shared boundary

- Never print tokens, secret payloads, credentials, customer data, or complete production records.
- Prefer explicit project, region, location, resource, and identity arguments over ambient defaults.
- Dry-run BigQuery SQL before execution and inspect partition filters and scan scope.
- A request for SQL text does not authorize query execution.
- Cloud writes, deployments, job execution, IAM changes, and end-to-end workflows require explicit approval.
- Follow the selected reference when its read-only query policy is more specific. Carrefour permits bounded `SELECT` queries under its slot-based billing policy; Air France requires approval before a billable query.
- Report the active identity, billing project, target project or resource, read/write classification, cost or capacity concern, and operations not performed.
