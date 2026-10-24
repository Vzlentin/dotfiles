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

Write diagrams in Mermaid, render them to SVG with Pele, and put the SVG in the body as an image. Do not paste a ` ```mermaid ` block: it does not always render, and a parse error shows as raw text.

Pele is a library, installed with npm in the global prefix: `npm install -g pele`, so it is at `$(npm prefix -g)/lib/node_modules/pele` (here `~/.local/lib/node_modules/pele`). Do not install it in a project or with `npx`.

1. Check it: `test -f "$(npm prefix -g)/lib/node_modules/pele/dist/pele.js"`. If it is missing, ask the user if Pele is installed somewhere else, and suggest `npm install -g pele`, which puts it at the path above. Do not install it without asking.
2. Write the diagram to a temporary `.mmd` file and render it with `render-mermaid.mjs`, next to this file (`{baseDir}` is the directory of this `SKILL.md`):

   ```sh
   {baseDir}/render-mermaid.mjs /tmp/diagram.mmd /tmp/<name>.svg
   ```

   A parse error means the source is wrong. GitHub would fail on it too. Fix the source. For example, `call`, `end`, `class`, `style`, `click` and `graph` are reserved words, so they cannot be node IDs.
3. Look at the SVG before you use it. For example, `qlmanage -t -s 1600 -o /tmp /tmp/<name>.svg` makes a PNG that you can read.
4. Host it in a secret gist, and use the raw URL, which GitHub serves as `image/svg+xml`:

   ```sh
   url=$(gh gist create /tmp/<name>.svg -d "<repo>#<pr> diagram" | tail -1)
   gh api "gists/${url##*/}" --jq '.files["<name>.svg"].raw_url'
   ```

5. In the body: `![<short description>](<raw url>)`. To change a diagram, render it again and make a new gist, because the raw URL contains the commit of the gist.
