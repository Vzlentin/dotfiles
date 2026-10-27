---
name: writing-pr
description: Use when writing or editing a pull request title or body.
---

Load and follow the `outbound-writing` skill for voice. This skill adds the structure of a PR title and body.

dont write essays, dont include that you ran tests. rather, write a concise body. focus on diagrams, code samples/snippets (this can be internals, or even sample usage). use bullet points for the text you do write. 'validation/i ran tests' is not needed.
for visual changes (either directly ot indirectly) show a table of before and after with uploaded images/videos. 
for benchmarks, always show tables of before/after (baseline from target branch, candidate from the PR). 
dont add intermediate PR details - e.g. if we reduced PR size from +6k lines to +1k lines, dont even mention it lol. if we refactored from one commit to another it doesn't matter. only the final aggregate squash merge commit is what matters for commentary. 
for truly impressive, difficult, or high risk/wide scoped changes you might write the body like a technical blog (again with context, storytelling, code samples/before/after etc diagra,s, images whatever).
feel free to use code refs

## Diagrams

Load the `show-me` skill for the views: diagrams, call trees, before and after. Render each diagram to SVG with its Pele script, and put the SVG in the body as an image. Do not paste a ` ```mermaid ` block: it does not always render, and a parse error shows as raw text.

1. Host the SVG in a secret gist, and use the raw URL, which GitHub serves as `image/svg+xml`:

   ```sh
   url=$(gh gist create /tmp/<name>.svg -d "<repo>#<pr> diagram" | tail -1)
   gh api "gists/${url##*/}" --jq '.files["<name>.svg"].raw_url'
   ```

2. In the body: `![<short description>](<raw url>)`. To change a diagram, render it again and make a new gist, because the raw URL contains the commit of the gist.
