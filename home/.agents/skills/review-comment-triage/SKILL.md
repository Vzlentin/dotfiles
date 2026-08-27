---
name: review-comment-triage
description: Triage GitHub PR and GitLab MR review comments as legit, not legit, or needs opinion; verify each claim against the exact diff, repository standards, and originating spec; obtain an independent second judgment; and render a visual, paste-ready report with each original comment and a proposed response. Use when a user asks to go through review comments, assess reviewer feedback, draft replies, or explain why comments should or should not be acted on.
---

# Review Comment Triage

Review every in-scope human comment. Verify first, classify second, and render with the `show-me` skill.

This workflow is read-only by default. Do not edit code, post replies, resolve threads, approve reviews, or change PR/MR state unless the user explicitly asks for that separate action.

## Required companion skill

Load and follow the available `show-me` skill before rendering the final report. Read [the output template](references/output-template.md) before writing the answer.

For GitHub, also load `better-github-skill` and use its review-thread workflow. For GitLab, use `glab` and the discussions API.

## 1. Establish the review target

Before Git or code inspection:

1. Verify the repository root, branch, status, worktree, remotes, and local instruction files.
2. Preserve unrelated and untracked work.
3. Identify the PR or MR from the user's argument or the current branch.
4. Record the platform, repository/project, number, source branch, target branch, merge head SHA, author, reviewers, and URL.
5. Confirm the local `HEAD` against the remote review head. If they differ, state which revision you are reviewing.

If no review can be identified, ask for its URL or number.

## 2. Define the comment scope

Retrieve complete discussion data before filtering. Include resolution state, replies, review bodies, general comments, inline comments, positions, and outdated status where the platform provides them.

Select comments as follows:

- If the user names a reviewer, use that reviewer.
- If there is exactly one human reviewer besides the author, use that reviewer.
- If several human reviewers left substantive comments and the user did not identify one, list their names and ask which reviewers are in scope.
- Exclude system events and bots unless the user asks for them.
- Treat the first substantive note in a thread as the review comment. Use replies as context. Count a reply separately only when it raises a new claim.
- Default to unresolved actionable comments. If the user says "all", include resolved and outdated comments too, and label their state.

State the final count before analysis. Do not silently omit a substantive comment.

### GitHub retrieval

Use `better-github-skill`:

- `scripts/pr-snapshot.ts` for review metadata and state.
- `scripts/pr-threads.ts --all` for complete review conversations.
- Add `--author` when the reviewer is known.

Do not rely only on `gh pr view --comments`; it does not reliably expose all inline thread state.

### GitLab retrieval

Use `glab` read-only commands. Prefer the discussions endpoint because it includes positions and thread state:

```bash
glab mr list --source-branch "$(git branch --show-current)" --all --output json
glab api --paginate 'projects/<project-id>/merge_requests/<iid>/discussions?per_page=100'
```

Use the notes endpoint only as a cross-check for completeness.

## 3. Resolve every comment against the exact revision

For each inline comment, record:

- exact original text;
- author and discussion ID or note ID;
- file and line;
- resolved and outdated state;
- `base_sha`, `start_sha`, and `head_sha` when available;
- old or new side of the diff;
- the exact commented diff hunk that includes the anchored line and enough surrounding code to make the comment understandable.

Inspect the line at the SHA stored in the comment position. Do not infer an old-line anchor from the current target branch because that branch can advance after the comment was created.

Prefer the diff hunk stored by the review platform. Preserve it exactly. If the platform does not provide one, reproduce the smallest coherent hunk from the stored base and head SHAs and label it `Reconstructed commented diff`. Record the path, abbreviated base and head SHAs, side, and anchored line outside the `diff` fence. Do not add highlights, ellipses, or annotations inside the fence. If the position or revision cannot be retrieved, say that the commented diff is unavailable and explain why. If later code differs and matters to the judgment, show it separately as a current diff.

Typical checks:

```bash
git show <base_sha>:<path> | nl -ba
git show <head_sha>:<path> | nl -ba
git diff -U20 <base_sha>...<head_sha> -- <path>
```

Then trace enough surrounding code, callers, tests, configuration, and history to test the reviewer's factual premise.

## 4. Find the decision sources

Read only the sources needed for the comments:

1. repository and workspace instructions;
2. originating issue, specification, ADR, plan, or acceptance criteria;
3. documented coding standards and established local conventions;
4. relevant production code and callers;
5. focused tests and test names;
6. commit history when it explains an invariant or rename.

When project memory exists, start at its nearest index and follow only relevant links.

Do not treat passing tests as proof that a comment is wrong. Tests are one item of evidence.

## 5. Build an evidence matrix

Before assigning labels, make a private matrix with one row per comment:

| Field | Question |
|---|---|
| Claim | What exactly does the reviewer assert or request? |
| Anchor | What exact code and revision does it refer to? |
| Premise | Is the factual premise true? |
| Behavior | Does current behavior fail or regress? |
| Spec | What does the originating requirement say? |
| Standards | Is there a documented rule or clear local convention? |
| Tradeoff | Would either option be valid depending on policy? |
| Scope | Is the request necessary, optional cleanup, or speculative? |
| Response | What concise reply can the author paste? |

Separate correctness from severity. A comment can be legit but non-blocking.

## 6. Classify

Use exactly these labels.

### Legit

Use `Legit` when the comment identifies one of these:

- a real behavioral defect or regression;
- a mismatch with the specification or acceptance criteria;
- a violated documented repository standard;
- a false or unenforced invariant that can cause incorrect behavior;
- a concrete, low-cost maintainability correction that follows a clear local convention and improves traceability or precision.

Add `blocking` or `non-blocking cleanup` in the explanation. Do not call every reasonable preference legit.

### Not legit

Use `Not legit` when:

- the premise is false at the exact commented revision;
- the requested ordering or guard already exists;
- the current behavior is intentional and explicitly required;
- the change would break another real caller or contract;
- the reviewer describes a workflow seam as a low-level adapter and proposes misplaced logic;
- the proposed abstraction has only one use and adds interface without leverage;
- the request is an optional alternative presented as necessary, with no supporting standard or defect.

Be respectful. Explain the strongest version of the concern before rejecting it.

### Needs opinion

Use `Needs opinion` only when the code and written sources do not decide the desired policy, or when the reviewer is challenging a written policy that only a product, domain, security, operations, or architecture owner can change.

Name the decision owner and show the alternatives, benefits, costs, and current default. Do not use this category merely because evidence collection is incomplete.

## 7. Obtain an independent judgment

Before final output, ask an independent agent to classify the same comments without showing it your labels. Give it:

- the PR/MR and exact head SHA;
- reviewer scope and full original comments;
- exact position metadata;
- relevant spec and standards paths;
- a read-only instruction;
- the three category definitions.

Follow the active harness's subagent policy. Use Herdr only when the user explicitly requests Herdr. If no independent agent is available, perform a separate contradiction pass and disclose that limitation.

Reconcile disagreements using evidence, not majority vote. Correct anchor mistakes before rendering. If the disagreement is a true policy choice, use `Needs opinion` and name the owner.

## 8. Optional implementation pass

Only when the user explicitly asks to address legit comments:

1. implement only the legit items;
2. keep changes small and preserve unrelated work;
3. add or update tests for production behavior;
4. run the smallest relevant checks, then documented quality targets when practical;
5. inspect the scoped diff and run `git diff --check`;
6. obtain a read-only review of the resulting diff;
7. render legit items as `Legit, addressed` only after verification.

Do not post replies or resolve threads without separate explicit permission.

## 9. Render with show-me

Follow [the output template](references/output-template.md).

For every comment, in original discussion order, use this exact order:

1. title;
2. exact original comment;
3. exact commented diff, with its path, revisions, side, and anchored line;
4. judgment;
5. the smallest useful visual from `show-me`, followed by the decisive evidence;
6. action, stating whether a code change was made, recommended, or rejected;
7. paste-ready proposed response in the comment's language.

The commented diff is evidence, not the `show-me` visual. Always include it for an inline comment. For a general comment with no code position, show the exact relevant diff only when the comment makes a code claim; otherwise label it `General comment: no diff anchor`.

Visual rules:

- For `Legit`, prefer a before/after state flow or a minimal corrected code shape.
- For `Not legit`, show the caller, ordering, seam, or guard that disproves the premise.
- For `Needs opinion`, show a decision tree and a compact tradeoff table.
- Use one visual per comment when it clarifies the decision. Do not force diagrams for simple renames.
- Do not create a persistent HTML artifact unless the concepts are too dense for inline diagrams or the user asks for one.

End with:

- counts by judgment;
- the comments that need an owner decision;
- verification performed and not performed;
- confirmation that no remote replies or thread-state changes were made.

## Safety

- Treat GitHub and GitLab as shared external systems.
- Retrieval is read-only. Posting, resolving, approving, requesting changes, and editing review metadata require explicit permission.
- Never claim a comment was addressed unless the change is present and verified.
- Never claim a response was posted when it was only drafted.
- Keep temporary API output outside the repository and do not commit review exports.
