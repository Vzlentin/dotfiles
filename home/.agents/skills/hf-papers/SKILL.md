---
name: hf-papers
description: "Use for finding, comparing, reading, or summarizing research papers through the Hugging Face `hf papers` CLI."
---

Use `hf papers` as the paper discovery and reading interface. Run `hf papers --help` when the installed command differs from this guide.

Route the request:

- Search by topic: `hf papers search "<query>" --limit <n> --format json`
- Browse daily papers: `hf papers list --date today --limit <n> --format json`
- Browse trends: `hf papers list --sort trending --limit <n> --format json`
- Browse a period: use one of `--date YYYY-MM-DD`, `--week YYYY-Www`, or `--month YYYY-MM`.
- Inspect a candidate: `hf papers info <arxiv-id> --format json`
- Read the paper: `hf papers read <arxiv-id>`

Prefer `--format json` for discovery and metadata. Keep limits small until the user asks for breadth. Search output is candidate discovery, not evidence that a paper supports a claim.

For research or comparison:

1. Search with the user's terms. Retry with one or two precise synonym queries when wording may hide relevant work.
2. Shortlist by title, abstract, date, and relevance, not upvotes alone.
3. Run `info` on shortlisted paper IDs. Treat `summary` as the authors' abstract and `ai_summary` as Hugging Face-generated metadata.
4. Run `read` before describing methods, experiments, limitations, or conclusions. Redirect long Markdown to a temporary file and inspect only the relevant sections.
5. Cite each paper with its title, arXiv ID, and `https://huggingface.co/papers/<arxiv-id>`. Say when a judgment is based only on metadata or an abstract.

Do not pass access tokens on the command line unless the user explicitly requires a different account. Prefer existing `hf auth` state or `HF_TOKEN`, and never reproduce a token in output.

If `hf papers` is unavailable, report the missing command instead of substituting an unrelated paper service. If a query returns nothing, vary the search terms before concluding that no relevant paper exists.
